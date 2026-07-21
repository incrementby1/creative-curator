import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.creative import get_hermes
from app.auth.identity import (
    clear_identity_verifier_cache,
    InvalidAccessToken,
    UserIdentity,
    get_identity_verifier,
)
from app.core.hermes import Hermes
from app.main import app
from app.persistence.session_store import InMemorySessionStore


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
            for dependency in (get_hermes, get_identity_verifier)
        }
        self.coordinator = Hermes(store=InMemorySessionStore())
        app.dependency_overrides[get_hermes] = lambda: self.coordinator
        app.dependency_overrides[get_identity_verifier] = FakeVerifier
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for dependency, previous in self._previous_overrides.items():
            if previous is self._missing_override:
                app.dependency_overrides.pop(dependency, None)
            else:
                app.dependency_overrides[dependency] = previous
        clear_identity_verifier_cache()

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
