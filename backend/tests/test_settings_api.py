from __future__ import annotations

import base64
import os
import unittest
from typing import Any
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.settings import clear_settings_service_cache, get_settings_service
from app.auth.identity import InvalidAccessToken, UserIdentity, get_identity_verifier
from app.llm.types import ProviderFailure
from app.main import app
from app.persistence.settings_store import InMemorySettingsStore
from app.security.credential_cipher import CredentialCipher
from app.settings.provider_registry import ProviderMetadata, ProviderRegistry
from app.settings.service import ProviderConnectionFailed, SettingsService
from app.settings.types import ProviderCredentialRecord


class FakeVerifier:
    def verify(self, token: str) -> UserIdentity:
        if token == "valid-a":
            return UserIdentity("user-a", "a@example.test")
        if token == "valid-b":
            return UserIdentity("user-b", "b@example.test")
        raise InvalidAccessToken("invalid or expired token")


class FakeProviderOperations:
    def __init__(self) -> None:
        self.tests: list[tuple[str, str, str, str | None]] = []
        self.discoveries: list[tuple[str, str, str | None]] = []
        self.models: list[str] = ["model-b", "model-a", "model-b"]
        self.failure: ProviderFailure | None = None

    def test_connection(
        self,
        provider: ProviderMetadata,
        api_key: str,
        model: str,
        base_url: str | None,
    ) -> None:
        self.tests.append((provider.slug, api_key, model, base_url))
        if self.failure is not None:
            raise self.failure

    def discover_models(
        self,
        provider: ProviderMetadata,
        api_key: str,
        base_url: str | None,
    ) -> list[str]:
        self.discoveries.append((provider.slug, api_key, base_url))
        if self.failure is not None:
            raise self.failure
        return list(self.models)


class SettingsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.missing = object()
        self.previous = {
            dependency: app.dependency_overrides.get(dependency, self.missing)
            for dependency in (get_identity_verifier, get_settings_service)
        }
        self.store = InMemorySettingsStore()
        self.operations = FakeProviderOperations()
        self.service = SettingsService(
            store=self.store,
            cipher=CredentialCipher(b"k" * 32),
            registry=ProviderRegistry.load_default(),
            operations=self.operations,
        )
        app.dependency_overrides[get_identity_verifier] = FakeVerifier
        app.dependency_overrides[get_settings_service] = lambda: self.service
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for dependency, previous in self.previous.items():
            if previous is self.missing:
                app.dependency_overrides.pop(dependency, None)
            else:
                app.dependency_overrides[dependency] = previous
        clear_settings_service_cache()

    @staticmethod
    def auth(token: str = "valid-a") -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def connect(
        self,
        token: str = "valid-a",
        slug: str = "openrouter",
        api_key: str = "sk-secret-4F2A",
        model: str = "model-a",
        base_url: str | None = None,
    ) -> Any:
        response = self.client.put(
            f"/settings/providers/{slug}",
            headers=self.auth(token),
            json={"api_key": api_key, "model": model, "base_url": base_url},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def test_every_settings_route_requires_authentication(self) -> None:
        requests = (
            ("GET", "/settings/providers", None),
            ("POST", "/settings/providers/openrouter/test", {"api_key": "k", "model": "m"}),
            ("POST", "/settings/providers/openrouter/models", {"api_key": "k"}),
            ("PUT", "/settings/providers/openrouter", {"api_key": "k", "model": "m"}),
            ("DELETE", "/settings/providers/openrouter", None),
            ("GET", "/settings/routing", None),
            ("PUT", "/settings/routing", {"primary": None, "fallbacks": [], "version": 1}),
        )
        for method, path, payload in requests:
            with self.subTest(path=path):
                response = self.client.request(method, path, json=payload)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["www-authenticate"], "Bearer")

    def test_default_settings_factory_fails_closed_without_master_key(self) -> None:
        clear_settings_service_cache()
        environment = {
            "APP_ENV": "test",
            "AUTH_MODE": "test",
            "SETTINGS_STORE_MODE": "memory",
            "LLM_TRANSPORT_MODE": "test",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(RuntimeError, "BYOK_MASTER_KEY"):
                get_settings_service()

    def test_test_transport_factory_uses_deterministic_zero_network_operations(self) -> None:
        clear_settings_service_cache()
        environment = {
            "APP_ENV": "test",
            "AUTH_MODE": "test",
            "SETTINGS_STORE_MODE": "memory",
            "LLM_TRANSPORT_MODE": "test",
            "BYOK_MASTER_KEY": base64.b64encode(b"k" * 32).decode(),
        }
        with patch.dict(os.environ, environment, clear=True), patch(
            "app.composition.LlmDispatcher"
        ) as dispatcher_type:
            service = get_settings_service()
            result = service.discover_models(
                "user-a", "openrouter", "test-key", None
            )
            approved_keys = (
                "test-key",
                "test-openrouter-4F2A",
                "test-deepseek-91BC",
                "test-gemini-7D3E",
                "test-key-4F2A",
            )
            for api_key in approved_keys:
                service.test_connection(
                    "user-a", "openrouter", api_key, "test-model", None
                )
            rejected_keys = (
                "real-looking-key",
                "",
                "test-" + ("x" * 129),
                "test-invalid space",
            )
            for api_key in rejected_keys:
                with self.assertRaises(ProviderConnectionFailed) as rejected:
                    service.test_connection(
                        "user-a", "openrouter", api_key, "test-model", None
                    )
                self.assertEqual(rejected.exception.category, "auth")

        dispatcher_type.assert_not_called()
        self.assertEqual(
            result,
            {
                "models": ["openrouter-test-model"],
                "manual_entry_required": False,
            },
        )

    def test_production_rejects_test_transport_before_http_construction(self) -> None:
        clear_settings_service_cache()
        environment = {
            "APP_ENV": "production",
            "AUTH_MODE": "supabase",
            "SETTINGS_STORE_MODE": "memory",
            "LLM_TRANSPORT_MODE": "test",
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "BYOK_MASTER_KEY": base64.b64encode(b"k" * 32).decode(),
        }
        with patch.dict(os.environ, environment, clear=True), patch(
            "app.composition.LlmDispatcher"
        ) as dispatcher_type:
            with self.assertRaisesRegex(RuntimeError, "test mode"):
                get_settings_service()

        dispatcher_type.assert_not_called()

    def test_catalog_is_hermes_manifest_order_with_public_metadata(self) -> None:
        response = self.client.get("/settings/providers", headers=self.auth())

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["manifest_version"], 1)
        self.assertEqual(len(payload["providers"]), 28)
        self.assertEqual(payload["providers"][0], {
            "slug": "openrouter",
            "display_name": "OpenRouter",
            "key_names": ["OPENROUTER_API_KEY"],
            "default_base_url": "https://openrouter.ai/api/v1",
            "base_url_env_names": ["OPENROUTER_BASE_URL"],
            "requires_custom_base_url": False,
            "model_discovery_supported": True,
            "manual_model_entry": True,
            "state": "not_connected",
            "masked_suffix": None,
            "configured_base_url": None,
            "tested_at": None,
        })

    def test_saved_provider_response_is_masked_and_secret_is_encrypted(self) -> None:
        response = self.connect()

        self.assertEqual(response.json()["masked_suffix"], "4F2A")
        self.assertEqual(response.json()["state"], "connected")
        self.assertNotIn("sk-secret", response.text)
        record = self.store.get_credential("user-a", "openrouter")
        self.assertIsNotNone(record)
        assert record is not None
        self.assertNotIn("sk-secret", repr(record))
        self.assertNotEqual(record.encrypted.ciphertext, "sk-secret-4F2A")
        self.assertEqual(self.operations.tests[-1][1], "sk-secret-4F2A")

    def test_save_replaces_only_authenticated_users_credential(self) -> None:
        self.connect("valid-a", api_key="key-a-old")
        self.connect("valid-b", api_key="key-b")
        self.connect("valid-a", api_key="key-a-new")

        record_a = self.store.get_credential("user-a", "openrouter")
        record_b = self.store.get_credential("user-b", "openrouter")
        assert record_a is not None and record_b is not None
        cipher = CredentialCipher(b"k" * 32)
        self.assertEqual(cipher.decrypt("user-a", "openrouter", record_a.encrypted), "key-a-new")
        self.assertEqual(cipher.decrypt("user-b", "openrouter", record_b.encrypted), "key-b")

    def test_failed_save_never_persists_or_leaks_key_or_upstream_detail(self) -> None:
        secret = "sk-must-not-leak"
        self.operations.failure = ProviderFailure("openrouter", "auth", False)

        response = self.client.put(
            "/settings/providers/openrouter",
            headers=self.auth(),
            json={"api_key": secret, "model": "m", "base_url": None},
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json(), {"detail": {"code": "provider_connection_failed", "category": "auth"}})
        self.assertNotIn(secret, response.text)
        self.assertIsNone(self.store.get_credential("user-a", "openrouter"))

    def test_request_validation_never_echoes_invalid_api_key(self) -> None:
        secret = "s" * 4097

        response = self.client.put(
            "/settings/providers/openrouter",
            headers=self.auth(),
            json={"api_key": secret, "model": "m", "base_url": None},
        )

        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret, response.text)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "api_key"])

    def test_transient_connection_test_never_persists_key(self) -> None:
        response = self.client.post(
            "/settings/providers/openrouter/test",
            headers=self.auth(),
            json={"api_key": "sk-transient", "model": "model-a", "base_url": None},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertIsNone(self.store.get_credential("user-a", "openrouter"))

    def test_connection_test_can_use_stored_key(self) -> None:
        self.connect(api_key="sk-stored")
        self.operations.tests.clear()

        response = self.client.post(
            "/settings/providers/openrouter/test",
            headers=self.auth(),
            json={"api_key": None, "model": "model-b", "base_url": None},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.operations.tests, [("openrouter", "sk-stored", "model-b", None)])

    def test_failed_stored_credential_test_marks_exact_connection_needs_attention(self) -> None:
        self.connect(api_key="sk-stored")
        self.operations.failure = ProviderFailure("openrouter", "auth", False)

        response = self.client.post(
            "/settings/providers/openrouter/test",
            headers=self.auth(),
            json={"api_key": None, "model": "model-b", "base_url": None},
        )

        self.assertEqual(response.status_code, 422)
        catalog = self.client.get("/settings/providers", headers=self.auth())
        provider = next(
            item for item in catalog.json()["providers"]
            if item["slug"] == "openrouter"
        )
        self.assertEqual(provider["state"], "needs_attention")

    def test_failed_stored_discovery_marks_exact_connection_needs_attention(self) -> None:
        self.connect(api_key="sk-stored")
        self.operations.failure = ProviderFailure("openrouter", "auth", False)

        response = self.client.post(
            "/settings/providers/openrouter/models",
            headers=self.auth(),
            json={"api_key": None, "base_url": None},
        )

        self.assertEqual(response.status_code, 422)
        record = self.store.get_credential("user-a", "openrouter")
        assert record is not None
        self.assertEqual(record.connection_state, "needs_attention")

    def test_stored_access_uses_one_exact_record_during_concurrent_replacement(self) -> None:
        cipher = CredentialCipher(b"k" * 32)

        class ReplacingStore(InMemorySettingsStore):
            replacement: ProviderCredentialRecord
            get_calls = 0

            def get_credential(
                self, user_id: str, provider_slug: str
            ) -> ProviderCredentialRecord | None:
                record = super().get_credential(user_id, provider_slug)
                self.get_calls += 1
                if self.get_calls == 1:
                    super().upsert_credential(user_id, self.replacement)
                return record

        for path, body, call_kind in (
            (
                "/settings/providers/openrouter/test",
                {"api_key": None, "model": "m", "base_url": None},
                "test",
            ),
            (
                "/settings/providers/openrouter/models",
                {"api_key": None, "base_url": None},
                "discovery",
            ),
        ):
            with self.subTest(path=path):
                store = ReplacingStore()
                old = ProviderCredentialRecord(
                    "openrouter",
                    cipher.encrypt("user-a", "openrouter", "old-key"),
                )
                replacement = ProviderCredentialRecord(
                    "openrouter",
                    cipher.encrypt("user-a", "openrouter", "new-key"),
                )
                store.upsert_credential("user-a", old)
                store.replacement = replacement
                operations = FakeProviderOperations()
                operations.failure = ProviderFailure("openrouter", "auth", False)
                service = SettingsService(
                    store=store,
                    cipher=cipher,
                    registry=ProviderRegistry.load_default(),
                    operations=operations,
                )
                app.dependency_overrides[get_settings_service] = lambda: service

                response = self.client.post(path, headers=self.auth(), json=body)

                self.assertEqual(response.status_code, 422)
                self.assertEqual(store.get_calls, 1)
                used_key = (
                    operations.tests[0][1]
                    if call_kind == "test"
                    else operations.discoveries[0][1]
                )
                self.assertEqual(used_key, "old-key")
                current = InMemorySettingsStore.get_credential(
                    store, "user-a", "openrouter"
                )
                assert current is not None
                self.assertEqual(
                    cipher.decrypt("user-a", "openrouter", current.encrypted),
                    "new-key",
                )
                self.assertEqual(current.connection_state, "connected")

    def test_model_discovery_sorts_deduplicates_and_does_not_persist_transient_key(self) -> None:
        response = self.client.post(
            "/settings/providers/openrouter/models",
            headers=self.auth(),
            json={"api_key": "sk-transient", "base_url": None},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"models": ["model-a", "model-b"], "manual_entry_required": False})
        self.assertIsNone(self.store.get_credential("user-a", "openrouter"))

    def test_model_discovery_can_use_stored_key(self) -> None:
        self.connect(api_key="sk-stored")
        self.operations.discoveries.clear()

        response = self.client.post(
            "/settings/providers/openrouter/models",
            headers=self.auth(),
            json={"api_key": None, "base_url": None},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.operations.discoveries, [("openrouter", "sk-stored", None)])

    def test_stored_key_operations_reuse_stored_custom_endpoint(self) -> None:
        self.connect(
            slug="custom",
            api_key="sk-stored",
            base_url="https://custom.example/v1",
        )
        self.operations.tests.clear()
        self.operations.discoveries.clear()

        tested = self.client.post(
            "/settings/providers/custom/test",
            headers=self.auth(),
            json={"api_key": None, "model": "model-b", "base_url": None},
        )
        discovered = self.client.post(
            "/settings/providers/custom/models",
            headers=self.auth(),
            json={"api_key": None, "base_url": None},
        )

        self.assertEqual(tested.status_code, 200, tested.text)
        self.assertEqual(discovered.status_code, 200, discovered.text)
        self.assertEqual(
            self.operations.tests,
            [("custom", "sk-stored", "model-b", "https://custom.example/v1")],
        )
        self.assertEqual(
            self.operations.discoveries,
            [("custom", "sk-stored", "https://custom.example/v1")],
        )

    def test_transient_key_never_inherits_stored_endpoint(self) -> None:
        self.connect(
            slug="openrouter",
            api_key="sk-stored",
            base_url="https://stored.example/v1",
        )
        self.operations.tests.clear()

        transient = self.client.post(
            "/settings/providers/openrouter/test",
            headers=self.auth(),
            json={"api_key": "sk-transient", "model": "m", "base_url": None},
        )
        stored = self.client.post(
            "/settings/providers/openrouter/test",
            headers=self.auth(),
            json={"api_key": None, "model": "m", "base_url": None},
        )

        self.assertEqual(transient.status_code, 200)
        self.assertEqual(stored.status_code, 200)
        self.assertEqual(
            self.operations.tests,
            [
                ("openrouter", "sk-transient", "m", None),
                ("openrouter", "sk-stored", "m", "https://stored.example/v1"),
            ],
        )

    def test_unsupported_model_discovery_requires_manual_entry_without_call(self) -> None:
        provider = next(
            item for item in self.service.registry.providers
            if not item.model_discovery.supported
        )

        response = self.client.post(
            f"/settings/providers/{provider.slug}/models",
            headers=self.auth(),
            json={"api_key": "key", "base_url": None},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"models": [], "manual_entry_required": True})
        self.assertEqual(self.operations.discoveries, [])

    def test_users_cannot_see_each_others_connections(self) -> None:
        self.connect("valid-a")

        response = self.client.get("/settings/providers", headers=self.auth("valid-b"))

        openrouter = next(item for item in response.json()["providers"] if item["slug"] == "openrouter")
        self.assertEqual(openrouter["state"], "not_connected")
        self.assertIsNone(openrouter["masked_suffix"])

    def test_routing_requires_connected_known_providers(self) -> None:
        unknown = self.client.put(
            "/settings/routing",
            headers=self.auth(),
            json={"primary": {"provider_slug": "unknown", "model": "m"}, "fallbacks": [], "version": 1},
        )
        disconnected = self.client.put(
            "/settings/routing",
            headers=self.auth(),
            json={"primary": {"provider_slug": "openrouter", "model": "m"}, "fallbacks": [], "version": 1},
        )

        self.assertEqual(unknown.status_code, 422)
        self.assertEqual(disconnected.status_code, 422)
        self.assertEqual(disconnected.json()["detail"]["code"], "provider_not_connected")

    def test_routing_round_trip_and_version_conflict(self) -> None:
        self.connect()
        payload = {
            "primary": {"provider_slug": "openrouter", "model": "model-a"},
            "fallbacks": [],
            "version": 1,
        }

        saved = self.client.put("/settings/routing", headers=self.auth(), json=payload)
        stale = self.client.put("/settings/routing", headers=self.auth(), json=payload)
        loaded = self.client.get("/settings/routing", headers=self.auth())

        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["version"], 2)
        self.assertEqual(loaded.json(), saved.json())
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json(), {"detail": {"code": "settings_version_conflict"}})

    def test_routing_rejects_more_than_five_fallbacks(self) -> None:
        response = self.client.put(
            "/settings/routing",
            headers=self.auth(),
            json={
                "primary": {"provider_slug": "openrouter", "model": "m"},
                "fallbacks": [
                    {"provider_slug": "openrouter", "model": f"m-{index}"}
                    for index in range(6)
                ],
                "version": 1,
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_routing_rejects_primary_repeated_as_fallback(self) -> None:
        self.connect()
        target = {"provider_slug": "openrouter", "model": "m"}

        response = self.client.put(
            "/settings/routing",
            headers=self.auth(),
            json={"primary": target, "fallbacks": [target], "version": 1},
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "invalid_settings")

    def test_delete_connected_provider_in_routing_returns_conflict_then_succeeds(self) -> None:
        self.connect()
        self.client.put(
            "/settings/routing",
            headers=self.auth(),
            json={"primary": {"provider_slug": "openrouter", "model": "m"}, "fallbacks": [], "version": 1},
        )

        conflict = self.client.delete("/settings/providers/openrouter", headers=self.auth())
        cleared = self.client.put(
            "/settings/routing",
            headers=self.auth(),
            json={"primary": None, "fallbacks": [], "version": 2},
        )
        deleted = self.client.delete("/settings/providers/openrouter", headers=self.auth())

        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json(), {"detail": {"code": "provider_in_use"}})
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(deleted.status_code, 204)
        self.assertIsNone(self.store.get_credential("user-a", "openrouter"))

    def test_delete_is_owner_scoped(self) -> None:
        self.connect("valid-a")

        response = self.client.delete(
            "/settings/providers/openrouter", headers=self.auth("valid-b")
        )

        self.assertEqual(response.status_code, 204)
        self.assertIsNotNone(self.store.get_credential("user-a", "openrouter"))

    def test_invalid_provider_and_custom_endpoint_validation_are_safe(self) -> None:
        missing = self.client.put(
            "/settings/providers/not-real",
            headers=self.auth(),
            json={"api_key": "secret", "model": "m", "base_url": None},
        )
        custom = self.client.put(
            "/settings/providers/custom",
            headers=self.auth(),
            json={"api_key": "secret", "model": "m", "base_url": None},
        )

        self.assertEqual(missing.status_code, 404)
        self.assertEqual(custom.status_code, 422)
        self.assertNotIn("secret", missing.text + custom.text)

    def test_key_prefix_route_cannot_bypass_supplied_endpoint_validation(self) -> None:
        response = self.client.put(
            "/settings/providers/kimi-coding",
            headers=self.auth(),
            json={
                "api_key": "sk-kimi-secret",
                "model": "m",
                "base_url": "http://127.0.0.1:9000/v1",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json()["detail"]["code"], "invalid_provider_configuration"
        )
        self.assertEqual(self.operations.tests, [])

    def test_provider_without_endpoint_override_rejects_custom_base_url(self) -> None:
        response = self.client.put(
            "/settings/providers/kimi-coding-cn",
            headers=self.auth(),
            json={
                "api_key": "secret",
                "model": "m",
                "base_url": "https://override.example/v1",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.operations.tests, [])


if __name__ == "__main__":
    unittest.main()
