from __future__ import annotations

import unittest
import json
import traceback
from unittest.mock import patch

import httpx

from app.llm.transports import MAX_RESPONSE_BYTES, EndpointPolicy, LlmDispatcher, resolve_provider_route
from app.llm.types import AiConfigurationRequired, AllProvidersFailed, AttemptFailure, LlmRequest, ProviderFailure
from app.settings.provider_registry import (
    EndpointSuffixRoute,
    KeyPrefixRoute,
    ModelDiscovery,
    ModelTransportRoute,
    ProviderMetadata,
    ProviderRegistry,
    ProviderRules,
)


PUBLIC = lambda _host: ("93.184.216.34",)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=None, chunks=None, headers=None):
        self.status_code = status_code
        if content is None:
            content = json.dumps(payload if payload is not None else {}).encode()
        self.chunks = list(chunks if chunks is not None else [content])
        self.headers = headers or {}
        self.chunks_read = 0
        self.closed = False

    def __enter__(self): return self
    def __exit__(self, *_args): self.closed = True
    def iter_bytes(self):
        for chunk in self.chunks:
            self.chunks_read += 1
            yield chunk


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def stream(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def request(slug="openrouter", base="https://example.com/v1", key="sk-secret", model="m"):
    return LlmRequest(slug, model, key, base, "system", {"b": 2, "a": 1})


def make_test_dispatcher(http, policy=None):
    return LlmDispatcher(
        test_client=http,
        allow_test_client=True,
        endpoint_policy=policy or EndpointPolicy(resolver=PUBLIC),
    )


class TransportTests(unittest.TestCase):
    def dispatch(self, transport, response, req=None):
        http = FakeHttp([response])
        dispatcher = make_test_dispatcher(http)
        result = dispatcher.dispatch(req or request(), transport)
        return result, http.calls[0]

    def test_chat_exact_payload_headers_and_extraction(self):
        result, call = self.dispatch(
            "chat", FakeResponse(payload={"choices": [{"message": {"content": "ok"}}]})
        )
        self.assertEqual(result.text, "ok")
        self.assertEqual(call[0:2], ("POST", "https://93.184.216.34/v1/chat/completions"))
        self.assertEqual(call[2]["headers"], {"Authorization": "Bearer sk-secret", "Content-Type": "application/json", "Host": "example.com"})
        self.assertEqual(call[2]["json"], {"model": "m", "messages": [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "USER_DATA_JSON\n{\"a\":1,\"b\":2}\nEND_USER_DATA_JSON"},
        ]})
        self.assertFalse(call[2]["follow_redirects"])

    def test_responses_exact_payload_and_nested_extraction(self):
        result, call = self.dispatch("responses", FakeResponse(payload={
            "output": [{"content": [{"type": "output_text", "text": "nested"}]}]
        }))
        self.assertEqual(result.text, "nested")
        self.assertEqual(call[0], "POST")
        self.assertEqual(call[1], "https://93.184.216.34/v1/responses")
        self.assertEqual(call[2]["json"], {
            "model": "m", "instructions": "system",
            "input": "USER_DATA_JSON\n{\"a\":1,\"b\":2}\nEND_USER_DATA_JSON",
        })
        self.assertEqual(call[2]["headers"], {"Authorization": "Bearer sk-secret", "Content-Type": "application/json", "Host": "example.com"})

    def test_anthropic_normalizes_v1_and_extracts_text(self):
        req = request("anthropic", "https://api.anthropic.com/v1")
        result, call = self.dispatch("anthropic", FakeResponse(payload={
            "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]
        }), req)
        self.assertEqual(result.text, "ab")
        self.assertEqual(call[0], "POST")
        self.assertEqual(call[1], "https://93.184.216.34/v1/messages")
        self.assertEqual(call[2]["headers"], {"x-api-key": "sk-secret", "anthropic-version": "2023-06-01", "Content-Type": "application/json", "Host": "api.anthropic.com"})
        self.assertEqual(call[2]["json"], {
            "model": "m", "max_tokens": 4096, "system": "system",
            "messages": [{"role": "user", "content": "USER_DATA_JSON\n{\"a\":1,\"b\":2}\nEND_USER_DATA_JSON"}],
        })

    def test_gemini_key_is_header_and_model_is_encoded(self):
        req = request("gemini", "https://generativelanguage.googleapis.com/v1beta", model="a/b")
        result, call = self.dispatch("gemini", FakeResponse(payload={
            "candidates": [{"content": {"parts": [{"text": "gem"}]}}]
        }), req)
        self.assertEqual(result.text, "gem")
        self.assertEqual(call[0], "POST")
        self.assertEqual(call[1], "https://93.184.216.34/v1beta/models/a%2Fb:generateContent")
        self.assertEqual(call[2]["headers"], {"x-goog-api-key": "sk-secret", "Content-Type": "application/json", "Host": "generativelanguage.googleapis.com"})
        self.assertEqual(call[2]["json"], {
            "systemInstruction": {"parts": [{"text": "system"}]},
            "contents": [{"role": "user", "parts": [{"text": "USER_DATA_JSON\n{\"a\":1,\"b\":2}\nEND_USER_DATA_JSON"}]}],
        })
        self.assertNotIn("sk-secret", call[1])

    def test_copilot_exchanges_at_fixed_endpoint_then_chats(self):
        http = FakeHttp([
            FakeResponse(payload={"token": "exchange-secret", "endpoints": {"api": "https://copilot.example"}}),
            FakeResponse(payload={"choices": [{"message": {"content": "copilot"}}]}),
        ])
        dispatcher = make_test_dispatcher(http)
        result = dispatcher.dispatch(request("copilot", "https://ignored.example", "github-secret"), "copilot")
        self.assertEqual(result.text, "copilot")
        self.assertEqual(http.calls[0][0], "GET")
        self.assertEqual(http.calls[0][1], "https://93.184.216.34/copilot_internal/v2/token")
        self.assertEqual(http.calls[0][2]["headers"], {"Authorization": "token github-secret", "Host": "api.github.com"})
        self.assertNotIn("json", http.calls[0][2])
        self.assertEqual(http.calls[1][0:2], ("POST", "https://93.184.216.34/chat/completions"))
        self.assertEqual(http.calls[1][2]["headers"], {"Authorization": "Bearer exchange-secret", "Content-Type": "application/json", "Host": "copilot.example"})
        self.assertEqual(http.calls[1][2]["json"], {"model": "m", "messages": [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "USER_DATA_JSON\n{\"a\":1,\"b\":2}\nEND_USER_DATA_JSON"},
        ]})

    def test_copilot_validates_each_request_endpoint_only_once(self):
        answers = iter([
            ("140.82.112.3",),
            ("93.184.216.34",),
            ("10.0.0.1",),
        ])
        resolutions = 0
        def resolver(_host):
            nonlocal resolutions
            resolutions += 1
            return next(answers)
        http = FakeHttp([
            FakeResponse(payload={"token": "exchange-secret", "endpoints": {"api": "https://copilot.example"}}),
            FakeResponse(payload={"choices": [{"message": {"content": "ok"}}]}),
        ])
        result = make_test_dispatcher(http, EndpointPolicy(resolver=resolver)).dispatch(
            request("copilot", "https://ignored.example", "github-secret"), "copilot"
        )
        self.assertEqual(result.text, "ok")
        self.assertEqual(resolutions, 2)
        self.assertEqual(http.calls[1][1], "https://93.184.216.34/chat/completions")

    def test_provider_rules_select_key_endpoint_model_fixed_then_auto(self):
        registry = ProviderRegistry.load_default()
        kimi = resolve_provider_route(registry.get("kimi-coding"), "x", "sk-kimi-123", None)
        self.assertEqual((kimi.base_url, kimi.transport), ("https://api.kimi.com/coding", "anthropic"))
        azure = registry.get("azure-foundry")
        self.assertEqual(resolve_provider_route(azure, "other", "k", "https://example.com/anthropic").transport, "anthropic")
        self.assertEqual(resolve_provider_route(azure, "gpt-5-mini", "k", "https://example.com").transport, "responses")
        self.assertEqual(resolve_provider_route(registry.get("anthropic"), "x", "k", None).transport, "anthropic")
        self.assertEqual(resolve_provider_route(registry.get("custom"), "x", "k", "https://example.com").transport, "chat")

    def test_rule_precedence_and_anthropic_joining_matrix(self):
        registry = ProviderRegistry.load_default()
        azure = registry.get("azure-foundry")
        # Endpoint beats model when both match.
        route = resolve_provider_route(azure, "gpt-5", "k", "https://example.com/anthropic/v1")
        self.assertEqual((route.transport, route.base_url), ("anthropic", "https://example.com/anthropic/v1"))
        self.assertEqual(resolve_provider_route(azure, "gpt-5", "k", "https://example.com").transport, "responses")
        zen = registry.get("opencode-zen")
        self.assertEqual(resolve_provider_route(zen, "claude-3", "k", None).transport, "anthropic")
        self.assertEqual(resolve_provider_route(zen, "gpt-5", "k", None).transport, "responses")
        go = registry.get("opencode-go")
        self.assertEqual(resolve_provider_route(go, "minimax-m2", "k", None).transport, "anthropic")
        self.assertEqual(resolve_provider_route(go, "other", "k", None).transport, "chat")
        # Fixed beats auto default, key-prefix wins before all other selectors.
        self.assertEqual(resolve_provider_route(registry.get("anthropic"), "gpt-5", "k", None).transport, "anthropic")
        kimi = resolve_provider_route(registry.get("kimi-coding"), "gpt-5", "sk-kimi-x", "https://example.com/anthropic")
        self.assertEqual((kimi.transport, kimi.base_url), ("anthropic", "https://api.kimi.com/coding"))
        for base, expected in (("https://example.com/anthropic", "https://93.184.216.34/anthropic/v1/messages"),
                               ("https://example.com/anthropic/v1", "https://93.184.216.34/anthropic/v1/messages")):
            req = request("azure-foundry", base)
            _, call = self.dispatch("anthropic", FakeResponse(payload={"content": [{"type": "text", "text": "ok"}]}), req)
            self.assertEqual(call[1], expected)
            self.assertNotIn("/v1/v1/", call[1])

    def test_each_provider_rule_precedence_level_is_explicit(self):
        provider = ProviderMetadata(
            slug="fixture", display_name="Fixture", key_names=("FIXTURE_KEY",),
            default_base_url="https://fixed.example/v1", base_url_env_names=(),
            requires_custom_base_url=False, transport="gemini",
            model_discovery=ModelDiscovery("none", False), manual_model_entry=False,
            rules=ProviderRules(
                key_prefix_routes=(KeyPrefixRoute("key-", "https://key.example/v1", "anthropic"),),
                endpoint_suffix_routes=(EndpointSuffixRoute(("/endpoint",), "chat"),),
                model_transport_routes=(ModelTransportRoute(("model-",), "responses"),),
            ),
        )
        self.assertEqual(resolve_provider_route(provider, "model-x", "key-x", "https://base.example/endpoint").transport, "anthropic")
        self.assertEqual(resolve_provider_route(provider, "model-x", "other", "https://base.example/endpoint").transport, "chat")
        self.assertEqual(resolve_provider_route(provider, "model-x", "other", "https://base.example/plain").transport, "responses")
        self.assertEqual(resolve_provider_route(provider, "other", "other", "https://base.example/plain").transport, "gemini")
        auto = ProviderMetadata(
            slug="auto-fixture", display_name="Auto", key_names=("AUTO_KEY",),
            default_base_url="https://auto.example/v1", base_url_env_names=(),
            requires_custom_base_url=False, transport="auto",
            model_discovery=ModelDiscovery("none", False), manual_model_entry=False,
            rules=ProviderRules(),
        )
        self.assertEqual(resolve_provider_route(auto, "other", "other", None).transport, "chat")

    def test_status_and_transport_exceptions_are_sanitized(self):
        cases = [(401, "auth", False), (408, "timeout", True), (429, "rate_limited", True),
                 (503, "unavailable", True), (400, "configuration", False)]
        for status, category, retriable in cases:
            with self.subTest(status=status):
                http = FakeHttp([FakeResponse(status, payload={"secret": "upstream-body"}, content=b"upstream-body")])
                dispatcher = make_test_dispatcher(http)
                with self.assertRaises(ProviderFailure) as raised:
                    dispatcher.dispatch(request(), "chat")
                self.assertEqual((raised.exception.category, raised.exception.retriable), (category, retriable))
                self.assertNotIn("upstream-body", repr(raised.exception))
                self.assertIsNone(raised.exception.__cause__)
                with self.assertRaises((AttributeError, TypeError)):
                    raised.exception.category = "configuration"
        for exc, category in [(httpx.ReadTimeout("key sk-secret"), "timeout"),
                              (httpx.ConnectError("upstream-body"), "unavailable")]:
            with self.subTest(exc=type(exc)):
                dispatcher = make_test_dispatcher(FakeHttp([exc]))
                with self.assertRaises(ProviderFailure) as raised:
                    dispatcher.dispatch(request(), "chat")
                self.assertEqual(raised.exception.category, category)
                self.assertNotIn("secret", repr(raised.exception))
                self.assertIsNone(raised.exception.__context__)

    def test_malformed_empty_oversize_and_redirect_are_invalid_response(self):
        responses = [
            FakeResponse(content=b"not-json"),
            FakeResponse(payload={}, content=b"{}"),
            FakeResponse(payload={}, content=b"x" * (1_048_577)),
            FakeResponse(302, payload={}, content=b"redirect"),
        ]
        for response in responses:
            http = FakeHttp([response])
            with self.assertRaises(ProviderFailure) as raised:
                make_test_dispatcher(http).dispatch(request(), "chat")
            self.assertEqual(raised.exception.category, "invalid_response")
            self.assertEqual(len(http.calls), 1)

    def test_endpoint_policy_rejects_unsafe_dns_before_http(self):
        unsafe = ["127.0.0.1", "10.0.0.1", "2130706433"]
        for address in unsafe:
            http = FakeHttp([])
            policy = EndpointPolicy(resolver=lambda _host, a=address: (a,))
            with self.assertRaises(ProviderFailure):
                make_test_dispatcher(http, policy).dispatch(request(), "chat")
            self.assertEqual(http.calls, [])
        http = FakeHttp([])
        policy = EndpointPolicy(resolver=lambda _host: ("93.184.216.34", "10.0.0.1"))
        with self.assertRaises(ProviderFailure):
            make_test_dispatcher(http, policy).dispatch(request(), "chat")
        self.assertEqual(http.calls, [])

        def broken_resolver(_host):
            raise RuntimeError("resolver-upstream-secret")
        with self.assertRaises(ProviderFailure) as raised:
            make_test_dispatcher(FakeHttp([]), EndpointPolicy(resolver=broken_resolver)).dispatch(request(), "chat")
        self.assertIsNone(raised.exception.__context__)

    def test_validated_endpoint_pins_single_dns_answer_and_preserves_host_and_sni(self):
        answers = iter([("93.184.216.34",), ("10.0.0.1",)])
        resolutions = 0
        def rebinding_resolver(_host):
            nonlocal resolutions
            resolutions += 1
            return next(answers)
        response = FakeResponse(payload={"choices": [{"message": {"content": "ok"}}]})
        http = FakeHttp([response])
        make_test_dispatcher(http, EndpointPolicy(resolver=rebinding_resolver)).dispatch(
            request(base="https://api.example:8443/v1"), "chat"
        )
        self.assertEqual(resolutions, 1)
        call = http.calls[0]
        self.assertEqual(call[1], "https://93.184.216.34:8443/v1/chat/completions")
        self.assertEqual(call[2]["headers"]["Host"], "api.example:8443")
        self.assertEqual(call[2]["extensions"], {"sni_hostname": "api.example"})
        self.assertNotIn("api.example", call[1])

    def test_endpoint_pinning_handles_ipv6_literals_and_test_loopback(self):
        cases = (
            ("https://ipv6.example/v1", lambda _host: ("2606:4700:4700::1111",),
             "https://[2606:4700:4700::1111]/v1/chat/completions", "ipv6.example", "ipv6.example", False),
            ("https://8.8.8.8/v1", lambda _host: self.fail("literal IP must not resolve again"),
             "https://8.8.8.8/v1/chat/completions", "8.8.8.8", "8.8.8.8", False),
            ("http://127.0.0.1:8000/v1", lambda _host: self.fail("loopback literal must not resolve again"),
             "http://127.0.0.1:8000/v1/chat/completions", "127.0.0.1:8000", None, True),
        )
        for base, resolver, pinned, host, sni, allow_loopback in cases:
            with self.subTest(base=base):
                http = FakeHttp([FakeResponse(payload={"choices": [{"message": {"content": "ok"}}]})])
                dispatcher = make_test_dispatcher(http, EndpointPolicy(
                    resolver=resolver, allow_loopback=allow_loopback
                ))
                dispatcher.dispatch(request(base=base), "chat")
                call = http.calls[0]
                self.assertEqual(call[1], pinned)
                self.assertEqual(call[2]["headers"]["Host"], host)
                expected_extensions = {"sni_hostname": sni} if sni else {}
                self.assertEqual(call[2]["extensions"], expected_extensions)

    def test_streaming_body_cap_stops_early_and_content_length_short_circuits(self):
        response = FakeResponse(chunks=[b"x" * MAX_RESPONSE_BYTES, b"yy", b"trailing"])
        http = FakeHttp([response])
        with self.assertRaises(ProviderFailure) as raised:
            make_test_dispatcher(http).dispatch(request(), "chat")
        self.assertEqual(raised.exception.category, "invalid_response")
        self.assertEqual(response.chunks_read, 2)
        self.assertTrue(response.closed)

    def test_dispatcher_closes_only_owned_client_once_and_supports_context_manager(self):
        injected = FakeHttp([])
        injected.close_calls = 0
        injected.close = lambda: setattr(injected, "close_calls", injected.close_calls + 1)
        with self.assertRaises(TypeError):
            LlmDispatcher(injected, endpoint_policy=EndpointPolicy(resolver=PUBLIC))
        with self.assertRaises(ValueError):
            LlmDispatcher(test_client=injected, endpoint_policy=EndpointPolicy(resolver=PUBLIC))
        dispatcher = LlmDispatcher(
            test_client=injected,
            allow_test_client=True,
            endpoint_policy=EndpointPolicy(resolver=PUBLIC),
        )
        self.assertIs(dispatcher.__enter__(), dispatcher)
        dispatcher.__exit__(None, None, None)
        dispatcher.close()
        self.assertEqual(injected.close_calls, 0)

        with patch("app.llm.transports.httpx.Client") as client_type:
            owned = client_type.return_value
            with LlmDispatcher(endpoint_policy=EndpointPolicy(resolver=PUBLIC)) as created:
                self.assertIsNotNone(created)
            created.close()
            self.assertEqual(owned.close.call_count, 1)
            self.assertFalse(client_type.call_args.kwargs["trust_env"])

        response = FakeResponse(chunks=[b"must-not-read"], headers={"Content-Length": str(MAX_RESPONSE_BYTES + 1)})
        with self.assertRaises(ProviderFailure):
            make_test_dispatcher(FakeHttp([response])).dispatch(request(), "chat")
        self.assertEqual(response.chunks_read, 0)
        self.assertTrue(response.closed)

    def test_request_is_copy_safe_and_secret_safe(self):
        payload = {"items": [1]}
        req = LlmRequest("p", "m", "sk-secret", "https://example.com", "s", payload)
        payload["items"].append(2)
        self.assertEqual(req.user_json["items"], (1,))
        self.assertNotIn("sk-secret", repr(req))
        with self.assertRaises(TypeError):
            req.user_json["x"] = 1

    def test_public_errors_are_sealed_and_validate_safe_aggregate_values(self):
        errors = [
            ProviderFailure("openrouter", "auth", False),
            AllProvidersFailed((AttemptFailure("openrouter", "auth"),)),
            AiConfigurationRequired(),
        ]
        for error in errors:
            try:
                raise error
            except Exception as caught:
                self.assertIs(caught, error)
                self.assertIsNotNone(caught.__traceback__)
        before = [(str(error), repr(error)) for error in errors]
        traceback_before = ["".join(traceback.format_exception(error)) for error in errors]
        for error in errors:
            with self.assertRaises(TypeError):
                error.__dict__["secret"] = "raw-secret"
            for name, value in (
                ("__cause__", RuntimeError("raw-cause-secret")),
                ("__context__", RuntimeError("raw-context-secret")),
                ("__traceback__", None),
                ("__suppress_context__", True),
            ):
                with self.subTest(error=type(error).__name__, chain_field=name):
                    with self.assertRaises((AttributeError, TypeError)):
                        setattr(error, name, value)
            for name, value in (("args", ("secret",)), ("new_field", "secret"),
                                ("category", "configuration"), ("provider_slug", "other"),
                                ("retriable", True), ("attempts", ())):
                with self.subTest(error=type(error).__name__, field=name):
                    with self.assertRaises((AttributeError, TypeError)):
                        setattr(error, name, value)
            for name in ("args", "category", "provider_slug", "retriable", "attempts"):
                with self.subTest(error=type(error).__name__, deleted_field=name):
                    with self.assertRaises((AttributeError, TypeError)):
                        delattr(error, name)
        self.assertEqual(before, [(str(error), repr(error)) for error in errors])
        self.assertEqual(traceback_before, ["".join(traceback.format_exception(error)) for error in errors])
        self.assertNotIn("raw-secret", "".join(traceback_before))
        self.assertNotIn("raw-cause-secret", "".join(traceback_before))
        self.assertNotIn("raw-context-secret", "".join(traceback_before))
        for factory in (
            lambda: ProviderFailure("BAD SLUG", "auth", False),
            lambda: ProviderFailure("safe", "evil", False),
            lambda: AttemptFailure("BAD SLUG", "auth"),
            lambda: AttemptFailure("safe", "evil"),
            lambda: AllProvidersFailed(("not-attempt",)),
        ):
            with self.assertRaises((TypeError, ValueError)):
                factory()


if __name__ == "__main__":
    unittest.main()
