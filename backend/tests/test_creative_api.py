import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.creative import get_hermes
from app.api.settings import get_settings_service
from app.auth.identity import (
    clear_identity_verifier_cache,
    InvalidAccessToken,
    UserIdentity,
    get_identity_verifier,
)
from app.core.hermes import Hermes
from app.composition import build_composition
from app.config import RuntimeConfig
from app.main import app
from app.llm.types import AiConfigurationRequired, AllProvidersFailed, AttemptFailure
from app.llm.transports import EndpointPolicy, LlmDispatcher
from app.security.credential_cipher import CredentialCipher
from app.settings.types import ProviderCredentialRecord, RouteTarget, RoutingSettings


START_PAYLOAD = {
    "brand_name": "Northstar Coffee",
    "description": "A neighborhood coffee bar bringing seasonal drinks to remote workers.",
    "goal": "Launch a memorable summer coffee collection for the neighborhood.",
    "reference": "Sun-washed Mediterranean editorial photography.",
}


class FakeVerifier:
    def verify(self, token: str) -> UserIdentity:
        if token == "valid-a":
            return UserIdentity(user_id="user-a", email="a@example.test")
        if token == "valid-b":
            return UserIdentity(user_id="user-b", email="b@example.test")
        raise InvalidAccessToken("invalid or expired token")


class FakeStructuredResponse:
    status_code = 200
    headers = {}

    def __init__(self, payload):
        self._content = json.dumps(payload).encode()

    def __enter__(self): return self
    def __exit__(self, *_args): return None
    def iter_bytes(self): yield self._content


class SchemaEnforcingOpenAiHttp:
    """Offline Responses fake that rejects unconstrained generation like the provider boundary."""

    def __init__(self):
        self.calls = []

    def stream(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        format_config = kwargs.get("json", {}).get("text", {}).get("format", {})
        if format_config.get("type") != "json_schema" or format_config.get("strict") is not True:
            response = FakeStructuredResponse({"error": {"message": "structured output required"}})
            response.status_code = 400
            return response
        name = format_config.get("name")
        if name == "dna_output":
            output = {
                "beliefs": ["Useful work", "Human voice", "Clear choices"],
                "tone_sliders": [
                    {"label": "Energy", "left": "Calm", "right": "Bold", "value": 55},
                    {"label": "Voice", "left": "Formal", "right": "Casual", "value": 65},
                ],
            }
        elif name == "direction_output":
            output = {"directions": [{
                "name": f"Direction {index}",
                "tone": tone,
                "visual_style": f"Visual system {index}",
                "creative_intent": f"Creative intent {index}",
                "palette": ["#17324D", "#F2C14E"],
                "channels": ["social"],
                "why_it_works": f"Specific rationale {index}",
            } for index, tone in enumerate(("Warm", "Bold", "Quiet"), 1)]}
        else:
            response = FakeStructuredResponse({"error": {"message": "unexpected schema"}})
            response.status_code = 400
            return response
        return FakeStructuredResponse({"output_text": json.dumps(output)})


def unrelated_dependency() -> str:
    return "default"


class CreativeApiTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_identity_verifier_cache()
        self._missing_override = object()
        self._previous_overrides = {
            dependency: app.dependency_overrides.get(
                dependency, self._missing_override
            )
            for dependency in (get_hermes, get_identity_verifier, get_settings_service)
        }
        self.composition = build_composition(RuntimeConfig(
            app_env="test",
            auth_mode="test",
            settings_store_mode="memory",
            llm_transport_mode="test",
            supabase_url="",
            supabase_anon_key="",
            supabase_service_role_key="",
            master_key=b"k" * 32,
        ))
        self.composition.settings_service.save_provider(
            "user-a", "openai-api", "test-key", "test-model", None
        )
        self.composition.settings_service.save_routing(
            "user-a", RouteTarget("openai-api", "test-model"), (), 1
        )
        self.coordinator = self.composition.hermes
        app.dependency_overrides[get_hermes] = lambda: self.coordinator
        app.dependency_overrides[get_identity_verifier] = FakeVerifier
        app.dependency_overrides[get_settings_service] = lambda: self.composition.settings_service
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for dependency, previous in self._previous_overrides.items():
            if previous is self._missing_override:
                app.dependency_overrides.pop(dependency, None)
            else:
                app.dependency_overrides[dependency] = previous
        clear_identity_verifier_cache()
        self.composition.close()

    def auth(self, token: str = "valid-a") -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def start_session(self, token: str = "valid-a") -> dict:
        response = self.client.post(
            "/creative/start", json=START_PAYLOAD, headers=self.auth(token)
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_missing_bearer_token_is_401(self) -> None:
        response = self.client.post("/creative/start", json=START_PAYLOAD)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["www-authenticate"], "Bearer")

    def test_malformed_or_empty_bearer_token_is_generic_401(self) -> None:
        for authorization in ("Basic abc", "Bearer", "Bearer "):
            with self.subTest(authorization=authorization):
                response = self.client.post(
                    "/creative/start",
                    json=START_PAYLOAD,
                    headers={"Authorization": authorization},
                )

                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["www-authenticate"], "Bearer")
                self.assertEqual(
                    response.json(),
                    {"detail": "Invalid authentication credentials."},
                )

    def test_invalid_or_expired_token_is_generic_401_and_never_echoed(self) -> None:
        token = "expired-sensitive-token"

        response = self.client.post(
            "/creative/start", json=START_PAYLOAD, headers=self.auth(token)
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["www-authenticate"], "Bearer")
        self.assertEqual(
            response.json(),
            {"detail": "Invalid authentication credentials."},
        )
        self.assertNotIn(token, response.text)

    def test_health_remains_public(self) -> None:
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)

    def test_missing_auth_config_does_not_override_missing_token_401(self) -> None:
        del app.dependency_overrides[get_identity_verifier]
        client = TestClient(app, raise_server_exceptions=False)

        try:
            with patch.dict("os.environ", {}, clear=True):
                missing_token = client.post("/creative/start", json=START_PAYLOAD)
                configured_token = client.post(
                    "/creative/start",
                    json=START_PAYLOAD,
                    headers={"Authorization": "Bearer cannot-be-verified"},
                )
                health = client.get("/health")
        finally:
            app.dependency_overrides[get_identity_verifier] = FakeVerifier

        self.assertEqual(missing_token.status_code, 401)
        self.assertEqual(missing_token.headers["www-authenticate"], "Bearer")
        self.assertEqual(configured_token.status_code, 500)
        self.assertEqual(health.status_code, 200)

    def test_every_creative_route_requires_auth(self) -> None:
        requests = (
            ("/creative/start", START_PAYLOAD),
            (
                "/creative/reject",
                {
                    "session_id": "session-a",
                    "rejections": [
                        {"direction_id": 1, "reason": "too_generic"},
                        {"direction_id": 2, "reason": "too_loud"},
                    ],
                },
            ),
            ("/creative/approve", {"session_id": "session-a"}),
            ("/creative/execute", {"session_id": "session-a"}),
        )

        for path, payload in requests:
            with self.subTest(path=path):
                response = self.client.post(path, json=payload)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["www-authenticate"], "Bearer")

        for path in ("/creative/sessions", "/creative/sessions/session-a"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["www-authenticate"], "Bearer")

    def test_valid_identity_owns_created_session(self) -> None:
        response = self.client.post(
            "/creative/start", json=START_PAYLOAD, headers=self.auth("valid-a")
        )

        self.assertEqual(response.status_code, 201)
        session = self.coordinator.get_session("user-a", response.json()["session_id"])
        self.assertEqual(session["user_id"], "user-a")

    def test_start_creates_an_active_session_with_brand_dna_and_directions(self) -> None:
        session = self.start_session()

        self.assertEqual(session["status"], "active")
        self.assertEqual(len(session["dna"]["beliefs"]), 3)
        self.assertEqual(len(session["directions"]), 3)
        self.assertIn("updated_at", session)

    def test_legacy_get_and_list_preserve_exact_session_and_owner_scope(self) -> None:
        session = self.start_session()
        session_id = session["session_id"]
        self.client.post("/creative/reject", json={"session_id": session_id, "rejections": [{"direction_id": 2, "reason": "too_loud"}, {"direction_id": 3, "reason": "not_authentic"}]}, headers=self.auth())
        self.client.post("/creative/approve", json={"session_id": session_id}, headers=self.auth())
        self.client.post("/creative/execute", json={"session_id": session_id}, headers=self.auth())
        before = self.coordinator.get_session("user-a", session_id)
        expected = json.loads(json.dumps({key: value for key, value in before.items() if key != "user_id"}))

        detail = self.client.get(f"/creative/sessions/{session_id}", headers=self.auth())
        listing = self.client.get("/creative/sessions", headers=self.auth())
        foreign = self.client.get(f"/creative/sessions/{session_id}", headers=self.auth("valid-b"))

        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json(), {**expected, "legacy": True})
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json(), [{**expected, "legacy": True}])
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(self.coordinator.get_session("user-a", session_id), before)
        self.assertNotIn("nodes", detail.json())
        self.assertNotIn("edges", detail.json())
        self.assertIsNotNone(detail.json()["refined_direction"])
        self.assertIsNotNone(detail.json()["artifact"])

    def test_start_succeeds_through_schema_enforcing_responses_transport(self) -> None:
        http = SchemaEnforcingOpenAiHttp()
        dispatcher = LlmDispatcher(
            test_client=http,
            allow_test_client=True,
            endpoint_policy=EndpointPolicy(resolver=lambda _host: ("93.184.216.34",)),
        )
        with patch("app.composition.LlmDispatcher", return_value=dispatcher):
            live = build_composition(RuntimeConfig(
                app_env="test",
                auth_mode="test",
                settings_store_mode="memory",
                llm_transport_mode="live",
                supabase_url="",
                supabase_anon_key="",
                supabase_service_role_key="",
                master_key=b"k" * 32,
            ))
        cipher = CredentialCipher(b"k" * 32)
        live.settings_store.upsert_credential(
            "user-a",
            ProviderCredentialRecord(
                "openai-api", cipher.encrypt("user-a", "openai-api", "fake-test-key")
            ),
        )
        live.settings_store.save_routing(
            "user-a", RoutingSettings("openai-api", "gpt-5.4")
        )
        previous = self.coordinator
        self.coordinator = live.hermes
        try:
            response = self.client.post(
                "/creative/start", json=START_PAYLOAD, headers=self.auth()
            )
        finally:
            self.coordinator = previous
            live.close()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(http.calls), 2)
        self.assertEqual(
            [call[2]["json"]["text"]["format"]["name"] for call in http.calls],
            ["dna_output", "direction_output"],
        )
        self.assertNotIn("fake-test-key", response.text)
        for _method, _url, kwargs in http.calls:
            self.assertNotIn("fake-test-key", json.dumps(kwargs["json"], default=str))

    def test_ai_configuration_required_is_exact_safe_conflict(self) -> None:
        class MissingConfiguration:
            def start_session(self, **_kwargs):
                raise AiConfigurationRequired()

        self.coordinator = MissingConfiguration()
        response = self.client.post(
            "/creative/start", json=START_PAYLOAD, headers=self.auth()
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": {"code": "ai_configuration_required"}})

    def test_provider_failures_are_exact_safe_service_unavailable(self) -> None:
        secret = "upstream-secret-body"

        class FailedProviders:
            def start_session(self, **_kwargs):
                try:
                    raise RuntimeError(secret)
                except RuntimeError:
                    raise AllProvidersFailed(
                        (AttemptFailure("openrouter", "timeout"), AttemptFailure("gemini", "auth"))
                    ) from None

        self.coordinator = FailedProviders()
        response = self.client.post(
            "/creative/start", json=START_PAYLOAD, headers=self.auth()
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": {
            "code": "all_providers_failed",
            "attempts": [
                {"provider_slug": "openrouter", "category": "timeout"},
                {"provider_slug": "gemini", "category": "auth"},
            ],
        }})
        self.assertNotIn(secret, response.text)

    def test_settings_routes_enable_creative_for_same_owner_only(self) -> None:
        provider = self.client.put(
            "/settings/providers/openai-api",
            json={"api_key": "test-user-b", "model": "test-model"},
            headers=self.auth("valid-b"),
        )
        routing = self.client.put(
            "/settings/routing",
            json={
                "primary": {"provider_slug": "openai-api", "model": "test-model"},
                "fallbacks": [],
                "version": 1,
            },
            headers=self.auth("valid-b"),
        )
        started = self.client.post(
            "/creative/start", json=START_PAYLOAD, headers=self.auth("valid-b")
        )

        self.assertEqual(provider.status_code, 200)
        self.assertEqual(routing.status_code, 200)
        self.assertEqual(started.status_code, 201)

    def test_reject_requires_exactly_two_rejections(self) -> None:
        session = self.start_session()

        response = self.client.post(
            "/creative/reject",
            json={
                "session_id": session["session_id"],
                "rejections": [{"direction_id": 1, "reason": "too_generic"}],
            },
            headers=self.auth(),
        )

        self.assertEqual(response.status_code, 422)

    def test_unknown_direction_and_active_approval_return_conflict(self) -> None:
        session = self.start_session()

        rejection_response = self.client.post(
            "/creative/reject",
            json={
                "session_id": session["session_id"],
                "rejections": [
                    {"direction_id": 2, "reason": "too_loud"},
                    {"direction_id": 999, "reason": "not_authentic"},
                ],
            },
            headers=self.auth(),
        )
        approval_response = self.client.post(
            "/creative/approve",
            json={"session_id": session["session_id"]},
            headers=self.auth(),
        )

        self.assertEqual(rejection_response.status_code, 409)
        self.assertEqual(approval_response.status_code, 409)

    def test_execute_missing_session_returns_not_found(self) -> None:
        response = self.client.post(
            "/creative/execute",
            json={"session_id": "00000000-0000-0000-0000-000000000000"},
            headers=self.auth(),
        )

        self.assertEqual(response.status_code, 404)

    def test_successful_lifecycle_and_approve_retry(self) -> None:
        session = self.start_session()
        rejected = self.client.post(
            "/creative/reject",
            json={
                "session_id": session["session_id"],
                "rejections": [
                    {"direction_id": 2, "reason": "too_loud"},
                    {"direction_id": 3, "reason": "not_authentic"},
                ],
            },
            headers=self.auth(),
        )
        approved = self.client.post(
            "/creative/approve",
            json={"session_id": session["session_id"]},
            headers=self.auth(),
        )
        repeated_approval = self.client.post(
            "/creative/approve",
            json={"session_id": session["session_id"]},
            headers=self.auth(),
        )
        executed = self.client.post(
            "/creative/execute",
            json={"session_id": session["session_id"]},
            headers=self.auth(),
        )
        approval_after_execution = self.client.post(
            "/creative/approve",
            json={"session_id": session["session_id"]},
            headers=self.auth(),
        )

        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.json()["status"], "refined_ready")
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["status"], "approved")
        self.assertEqual(repeated_approval.status_code, 200)
        self.assertEqual(repeated_approval.json()["status"], "approved")
        self.assertEqual(executed.status_code, 200)
        self.assertEqual(executed.json()["status"], "executed")
        self.assertEqual(approval_after_execution.status_code, 200)
        self.assertEqual(approval_after_execution.json()["status"], "executed")

    def test_execute_before_approval_returns_conflict(self) -> None:
        session = self.start_session()

        response = self.client.post(
            "/creative/execute",
            json={"session_id": session["session_id"]},
            headers=self.auth(),
        )

        self.assertEqual(response.status_code, 409)

    def test_other_user_cannot_mutate_session(self) -> None:
        session = self.start_session("valid-a")
        actions = (
            (
                "/creative/reject",
                {
                    "session_id": session["session_id"],
                    "rejections": [
                        {"direction_id": 2, "reason": "too_loud"},
                        {"direction_id": 3, "reason": "not_authentic"},
                    ],
                },
            ),
            ("/creative/approve", {"session_id": session["session_id"]}),
            ("/creative/execute", {"session_id": session["session_id"]}),
        )

        for path, payload in actions:
            with self.subTest(path=path):
                response = self.client.post(
                    path, json=payload, headers=self.auth("valid-b")
                )
                self.assertEqual(response.status_code, 404)


class DependencyOverrideIsolationTests(unittest.TestCase):
    def test_fixture_preserves_unrelated_dependency_override(self) -> None:
        sentinel = lambda: "sentinel"
        app.dependency_overrides[unrelated_dependency] = sentinel
        fixture = CreativeApiTests("test_health_remains_public")

        try:
            fixture.setUp()
            fixture.tearDown()
            self.assertIs(
                app.dependency_overrides.get(unrelated_dependency), sentinel
            )
        finally:
            app.dependency_overrides.pop(unrelated_dependency, None)


if __name__ == "__main__":
    unittest.main()
