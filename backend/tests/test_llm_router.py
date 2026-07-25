from __future__ import annotations

import traceback
import unittest
from dataclasses import replace
import json
from typing import TypeVar, get_args, get_type_hints

from pydantic import BaseModel

from app.llm.router import StructuredLlmRouter
from app.llm.schemas import ContentOutput, DirectionOutput, DnaOutput
from app.llm.types import (
    AiConfigurationRequired,
    AllProvidersFailed,
    AttemptFailure,
    LlmResult,
    ProviderFailure,
    thaw_json,
)
from app.persistence.settings_store import InMemorySettingsStore
from app.security.credential_cipher import CredentialCipher
from app.settings.provider_registry import ProviderRegistry
from app.settings.types import ProviderCredentialRecord, RouteTarget, RoutingSettings


class ExampleOutput(BaseModel):
    value: str


class FakeDispatcher:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def dispatch(self, request, transport):
        self.calls.append((request, transport))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return LlmResult(outcome, request.provider_slug, request.model)


class BrokenStore(InMemorySettingsStore):
    def get_routing(self, user_id):
        raise RuntimeError("store-secret")


class RouterTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySettingsStore()
        self.cipher = CredentialCipher(b"k" * 32)
        self.registry = ProviderRegistry.load_default()

    def connect(self, user, slug, key=None, base=None):
        key = key or f"key-{user}-{slug}"
        record = ProviderCredentialRecord(slug, self.cipher.encrypt(user, slug, key), base)
        self.store.upsert_credential(user, record)

    def route(self, user="u", primary=("openrouter", "m1"), fallbacks=()):
        settings = RoutingSettings(primary[0], primary[1], tuple(RouteTarget(*x) for x in fallbacks))
        self.store.save_routing(user, settings)

    def router(self, outcomes, store=None, cipher=None):
        dispatcher = FakeDispatcher(outcomes)
        return StructuredLlmRouter(store or self.store, cipher or self.cipher, self.registry, dispatcher), dispatcher

    def test_rate_limit_falls_back_in_order_and_model(self):
        self.connect("u", "openrouter"); self.connect("u", "anthropic")
        self.route(fallbacks=(("anthropic", "m2"),))
        router, d = self.router([ProviderFailure("openrouter", "rate_limited", True), '{"value":"ok"}'])
        self.assertEqual(router.generate("u", ExampleOutput, "sys", {"x": 1}).value, "ok")
        self.assertEqual([(c[0].provider_slug, c[0].model) for c in d.calls], [("openrouter", "m1"), ("anthropic", "m2")])

    def test_timeout_unavailable_auth_all_fall_back(self):
        for category in ("timeout", "unavailable", "auth"):
            with self.subTest(category=category):
                self.setUp(); self.connect("u", "openrouter"); self.connect("u", "anthropic")
                self.route(fallbacks=(("anthropic", "m2"),))
                router, _ = self.router([ProviderFailure("openrouter", category, category != "auth"), '{"value":"ok"}'])
                self.assertEqual(router.generate("u", ExampleOutput, "s", {}).value, "ok")

    def test_only_auth_marks_owner_credential_needs_attention(self):
        for category, expected in (("auth", "needs_attention"), ("timeout", "connected")):
            with self.subTest(category=category):
                self.setUp(); self.connect("u", "openrouter"); self.route()
                router, _ = self.router([ProviderFailure("openrouter", category, False)])
                with self.assertRaises(AllProvidersFailed): router.generate("u", ExampleOutput, "s", {})
                self.assertEqual(self.store.get_credential("u", "openrouter").connection_state, expected)

    def test_missing_primary_is_typed_configuration_required(self):
        router, _ = self.router([])
        with self.assertRaises(AiConfigurationRequired):
            router.generate("u", ExampleOutput, "s", {})

    def test_missing_credential_provider_and_custom_base_are_safe_attempts(self):
        cases = [
            (("openrouter", "m"), None),
            (("not-real", "m"), None),
            (("custom", "m"), None),
        ]
        for primary, connect in cases:
            with self.subTest(primary=primary):
                self.setUp(); self.route(primary=primary)
                if primary[0] == "custom": self.connect("u", "custom")
                router, d = self.router([])
                with self.assertRaises(AllProvidersFailed) as raised:
                    router.generate("u", ExampleOutput, "s", {})
                self.assertEqual(raised.exception.attempts[0].category, "configuration")
                self.assertEqual(d.calls, [])

    def test_cross_user_keys_are_never_used(self):
        self.connect("other", "openrouter", "other-secret"); self.route("u")
        router, d = self.router([])
        with self.assertRaises(AllProvidersFailed): router.generate("u", ExampleOutput, "s", {})
        self.assertEqual(d.calls, [])

    def test_decrypt_failure_marks_attention_then_falls_back(self):
        corrupt_cipher = CredentialCipher(b"x" * 32)
        self.store.upsert_credential("u", ProviderCredentialRecord(
            "openrouter", corrupt_cipher.encrypt("u", "openrouter", "bad-primary")
        ))
        self.connect("u", "anthropic"); self.route(fallbacks=(("anthropic", "m2"),))
        router, d = self.router(['{"value":"ok"}'])
        self.assertEqual(router.generate("u", ExampleOutput, "s", {}).value, "ok")
        self.assertEqual(self.store.get_credential("u", "openrouter").connection_state, "needs_attention")
        self.assertEqual(self.store.get_credential("u", "anthropic").connection_state, "connected")
        self.assertEqual([(call[0].provider_slug, call[0].model) for call in d.calls], [("anthropic", "m2")])

    def test_auth_attention_isolated_to_failing_owner_and_provider(self):
        self.connect("u", "openrouter"); self.connect("u", "anthropic")
        self.connect("other", "openrouter"); self.route(fallbacks=(("anthropic", "m2"),))
        router, d = self.router([ProviderFailure("openrouter", "auth", False), '{"value":"ok"}'])
        self.assertEqual(router.generate("u", ExampleOutput, "s", {}).value, "ok")
        self.assertEqual(self.store.get_credential("u", "openrouter").connection_state, "needs_attention")
        self.assertEqual(self.store.get_credential("u", "anthropic").connection_state, "connected")
        self.assertEqual(self.store.get_credential("other", "openrouter").connection_state, "connected")
        self.assertEqual([call[0].provider_slug for call in d.calls], ["openrouter", "anthropic"])

    def test_concurrent_credential_replacement_is_not_overwritten_by_auth_mark(self):
        class ReplacingStore(InMemorySettingsStore):
            def __init__(inner):
                super().__init__()
                inner.mark_calls = 0
            def mark_credential_state(inner, user, expected, state):
                inner.mark_calls += 1
                replacement = ProviderCredentialRecord(
                    expected.provider_slug,
                    self.cipher.encrypt(user, expected.provider_slug, "replacement-key"),
                )
                inner.upsert_credential(user, replacement)
                return super().mark_credential_state(user, expected, state)
        store = ReplacingStore()
        original = ProviderCredentialRecord(
            "openrouter", self.cipher.encrypt("u", "openrouter", "original-key")
        )
        store.upsert_credential("u", original)
        store.save_routing("u", RoutingSettings("openrouter", "m1"))
        router, _ = self.router([ProviderFailure("openrouter", "auth", False)], store=store)
        with self.assertRaises(AllProvidersFailed):
            router.generate("u", ExampleOutput, "s", {})
        current = store.get_credential("u", "openrouter")
        self.assertEqual(store.mark_calls, 1)
        self.assertEqual(current.connection_state, "connected")
        self.assertNotEqual(current.encrypted, original.encrypted)

    def test_generate_preserves_concrete_pydantic_output_type_hint(self):
        hints = get_type_hints(StructuredLlmRouter.generate)
        output_argument = get_args(hints["output_model"])[0]
        self.assertIsInstance(output_argument, TypeVar)
        self.assertIs(output_argument.__bound__, BaseModel)
        self.assertIs(hints["return"], output_argument)

    def test_fallbacks_dedupe_primary_and_cap_five(self):
        for slug in ("openrouter", "anthropic", "gemini", "deepseek", "xai", "nvidia"):
            self.connect("u", slug)
        fallbacks = (("openrouter", "m1"), ("anthropic", "m2"), ("gemini", "m3"),
                     ("deepseek", "m4"), ("xai", "m5"), ("nvidia", "m6"))
        # Simulate corrupt/external settings exceeding domain validation.
        class Store(InMemorySettingsStore):
            def get_routing(inner, _user):
                obj = object.__new__(RoutingSettings)
                object.__setattr__(obj, "primary_provider_slug", "openrouter")
                object.__setattr__(obj, "primary_model", "m1")
                object.__setattr__(obj, "fallbacks", tuple(RouteTarget(*x) for x in fallbacks))
                object.__setattr__(obj, "version", 1)
                return obj
            get_credential = self.store.get_credential
            upsert_credential = self.store.upsert_credential
        router, d = self.router([ProviderFailure(s, "unavailable", True) for s, _ in fallbacks], store=Store())
        with self.assertRaises(AllProvidersFailed): router.generate("u", ExampleOutput, "s", {})
        self.assertEqual(len(d.calls), 5)

    def test_valid_schema_returns_model(self):
        user_marker = "must-not-enter-schema"
        self.connect("u", "openrouter"); self.route(); router, d = self.router(['{"value":"yes"}'])
        out = router.generate("u", ExampleOutput, "system", {"draft": user_marker})
        self.assertEqual(out, ExampleOutput(value="yes")); self.assertEqual(len(d.calls), 1)
        request = d.calls[0][0]
        self.assertEqual(getattr(request, "output_schema_name", None), "example_output")
        schema = getattr(request, "output_schema", None)
        self.assertIsNotNone(schema)
        self.assertEqual(schema["properties"]["value"]["type"], "string")
        self.assertNotIn(
            user_marker,
            request.output_schema_name + json.dumps(thaw_json(schema)),
        )

    def test_invalid_json_gets_one_repair_same_provider(self):
        self.connect("u", "openrouter"); self.route(); router, d = self.router(["not-json", '{"value":"fixed"}'])
        self.assertEqual(router.generate("u", ExampleOutput, "system", {}).value, "fixed")
        self.assertEqual(len(d.calls), 2)
        self.assertEqual(d.calls[0][0].provider_slug, d.calls[1][0].provider_slug)
        self.assertIn("Correct the prior response", d.calls[1][0].system_prompt)
        self.assertIn("not-json", str(d.calls[1][0].user_json))
        self.assertEqual(
            getattr(d.calls[0][0], "output_schema_name", None),
            getattr(d.calls[1][0], "output_schema_name", None),
        )
        self.assertEqual(
            getattr(d.calls[0][0], "output_schema", None),
            getattr(d.calls[1][0], "output_schema", None),
        )

    def test_complete_outer_json_fence_is_validated_without_repair(self):
        self.connect("u", "openrouter"); self.route()
        router, dispatcher = self.router(['```json\n{"value":"fenced"}\n```'])

        self.assertEqual(router.generate("u", ExampleOutput, "system", {}).value, "fenced")
        self.assertEqual(len(dispatcher.calls), 1)

    def test_single_output_wrapper_is_validated_without_repair(self):
        self.connect("u", "openrouter"); self.route()
        router, dispatcher = self.router(['{"output":{"value":"wrapped"}}'])

        self.assertEqual(router.generate("u", ExampleOutput, "system", {}).value, "wrapped")
        self.assertEqual(len(dispatcher.calls), 1)

    def test_backticks_inside_raw_json_string_are_not_treated_as_fence(self):
        self.connect("u", "openrouter"); self.route()
        router, dispatcher = self.router(['{"value":"keep ```json literal"}'])

        self.assertEqual(
            router.generate("u", ExampleOutput, "system", {}).value,
            "keep ```json literal",
        )
        self.assertEqual(len(dispatcher.calls), 1)

    def test_incomplete_fence_still_uses_bounded_repair(self):
        self.connect("u", "openrouter"); self.route()
        router, dispatcher = self.router([
            '```json\n{"value":"broken"}',
            '{"value":"fixed"}',
        ])

        self.assertEqual(router.generate("u", ExampleOutput, "system", {}).value, "fixed")
        self.assertEqual(len(dispatcher.calls), 2)

    def test_failed_single_repair_remains_safe_invalid_response(self):
        self.connect("u", "openrouter", "sk-secret-key"); self.route()
        router, d = self.router(['{"wrong":"raw-output-secret"}', "still-invalid raw-output-secret"])

        with self.assertRaises(AllProvidersFailed) as raised:
            router.generate("u", ExampleOutput, "system", {"private": "user-input-secret"})

        self.assertEqual(len(d.calls), 2)
        self.assertEqual(
            raised.exception.attempts,
            (AttemptFailure("openrouter", "invalid_response"),),
        )
        rendered = repr(raised.exception) + str(raised.exception)
        self.assertNotIn("sk-secret-key", rendered)
        self.assertNotIn("raw-output-secret", rendered)
        self.assertNotIn("user-input-secret", rendered)

    def test_creative_schemas_use_openai_supported_array_shape(self):
        unsupported = {
            "prefixItems", "allOf", "not", "dependentRequired",
            "dependentSchemas", "if", "then", "else",
        }

        def assert_supported(node):
            if isinstance(node, dict):
                self.assertFalse(unsupported.intersection(node))
                if node.get("type") == "object":
                    properties = node.get("properties", {})
                    self.assertEqual(set(node.get("required", [])), set(properties))
                    self.assertIs(node.get("additionalProperties"), False)
                for value in node.values():
                    assert_supported(value)
            elif isinstance(node, list):
                for value in node:
                    assert_supported(value)

        for output_model in (DnaOutput, DirectionOutput, ContentOutput):
            with self.subTest(output_model=output_model.__name__):
                schema = output_model.model_json_schema()
                self.assertEqual(schema.get("type"), "object")
                assert_supported(schema)

    def test_invalid_schema_repair_failure_then_fallback_exactly_three_calls(self):
        self.connect("u", "openrouter"); self.connect("u", "anthropic"); self.route(fallbacks=(("anthropic", "m2"),))
        router, d = self.router(['{"wrong":"raw-secret"}', "still-invalid raw-secret", '{"value":"ok"}'])
        self.assertEqual(router.generate("u", ExampleOutput, "s", {}).value, "ok")
        self.assertEqual(len(d.calls), 3)

    def test_repair_preparation_failure_continues_to_fallback(self):
        self.connect("u", "openrouter"); self.connect("u", "anthropic")
        self.route(fallbacks=(("anthropic", "m2"),))
        original = self.store.get_credential
        reads = 0
        def changing_credential(user, slug):
            nonlocal reads
            if slug == "openrouter":
                reads += 1
                if reads > 1:
                    return None
            return original(user, slug)
        self.store.get_credential = changing_credential
        router, d = self.router(["invalid", '{"value":"fallback"}'])
        self.assertEqual(router.generate("u", ExampleOutput, "s", {}).value, "fallback")
        self.assertEqual(len(d.calls), 2)

    def test_all_failed_error_is_ordered_and_secret_safe(self):
        self.connect("u", "openrouter", "sk-raw-key"); self.route()
        router, _ = self.router([ProviderFailure("openrouter", "unavailable", True)])
        with self.assertRaises(AllProvidersFailed) as raised:
            router.generate("u", ExampleOutput, "s", {"raw": "invalid-output-secret"})
        rendered = str(raised.exception) + repr(raised.exception) + "".join(traceback.format_exception(raised.exception))
        self.assertIn("openrouter", rendered); self.assertIn("unavailable", rendered)
        self.assertNotIn("sk-raw-key", rendered); self.assertNotIn("invalid-output-secret", rendered)
        self.assertIsNone(raised.exception.__cause__)
        with self.assertRaises((AttributeError, TypeError)):
            raised.exception.attempts = ()

    def test_settings_errors_and_failed_attention_mark_are_sanitized(self):
        router, _ = self.router([], store=BrokenStore())
        with self.assertRaises(AllProvidersFailed) as raised:
            router.generate("u", ExampleOutput, "s", {})
        self.assertNotIn("store-secret", repr(raised.exception))
        self.assertIsNone(raised.exception.__context__)

        class MarkBroken(InMemorySettingsStore):
            get_routing = self.store.get_routing
            get_credential = self.store.get_credential
            def mark_credential_state(inner, user, record, state): raise RuntimeError("mark-secret")
        self.connect("u", "openrouter"); self.route()
        router, _ = self.router([ProviderFailure("openrouter", "auth", False)], store=MarkBroken())
        with self.assertRaises(AllProvidersFailed) as raised:
            router.generate("u", ExampleOutput, "s", {})
        self.assertNotIn("mark-secret", repr(raised.exception))


if __name__ == "__main__":
    unittest.main()
