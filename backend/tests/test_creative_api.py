import unittest

from fastapi.testclient import TestClient

from app.api.creative import get_hermes
from app.core.hermes import Hermes
from app.main import app
from app.persistence.session_store import InMemorySessionStore


START_PAYLOAD = {
    "brand_name": "Northstar Coffee",
    "description": "A neighborhood coffee bar bringing seasonal drinks to remote workers.",
    "goal": "Launch a memorable summer coffee collection for the neighborhood.",
    "reference": "Sun-washed Mediterranean editorial photography.",
}


class CreativeApiTests(unittest.TestCase):
    def setUp(self) -> None:
        coordinator = Hermes(store=InMemorySessionStore())
        app.dependency_overrides[get_hermes] = lambda: coordinator
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def start_session(self) -> dict:
        response = self.client.post("/creative/start", json=START_PAYLOAD)
        self.assertEqual(response.status_code, 201)
        return response.json()

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
        )
        approval_response = self.client.post(
            "/creative/approve", json={"session_id": session["session_id"]}
        )

        self.assertEqual(rejection_response.status_code, 409)
        self.assertEqual(approval_response.status_code, 409)

    def test_execute_missing_session_returns_not_found(self) -> None:
        response = self.client.post(
            "/creative/execute",
            json={"session_id": "00000000-0000-0000-0000-000000000000"},
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
        )
        approved = self.client.post(
            "/creative/approve", json={"session_id": session["session_id"]}
        )
        repeated_approval = self.client.post(
            "/creative/approve", json={"session_id": session["session_id"]}
        )
        executed = self.client.post(
            "/creative/execute", json={"session_id": session["session_id"]}
        )
        approval_after_execution = self.client.post(
            "/creative/approve", json={"session_id": session["session_id"]}
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
            "/creative/execute", json={"session_id": session["session_id"]}
        )

        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
