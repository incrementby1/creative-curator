import sys
import unittest
from pathlib import Path

# Allow running tests from repo root (so `import app.*` resolves).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.hermes import (
    DirectionNotFoundError,
    Hermes,
    InvalidSessionStateError,
    SessionNotFoundError,
)
from app.core.types import Rejection
from app.persistence.session_store import InMemorySessionStore


class RecoverableSessionStore(InMemorySessionStore):
    def __init__(self) -> None:
        super().__init__()
        self.fail_create = False
        self.fail_save = False
        self.last_create_id: str | None = None

    def create(self, session_id: str, state: dict) -> None:
        self.last_create_id = session_id
        if self.fail_create:
            raise RuntimeError("create unavailable")
        super().create(session_id, state)

    def save(self, session_id: str, state: dict) -> None:
        if self.fail_save:
            raise RuntimeError("save unavailable")
        super().save(session_id, state)


class HermesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.hermes = Hermes(store=InMemorySessionStore())

    def start(self) -> dict:
        return self.hermes.start_session(
            brand_name="Acme",
            description="A modern neighborhood coffee shop with seasonal drinks.",
            goal="Launch a new summer collection",
            reference="Sun-washed Mediterranean editorial photography",
        )

    @staticmethod
    def reject_two() -> list[Rejection]:
        return [
            Rejection(direction_id=2, reason="too_loud"),
            Rejection(direction_id=3, reason="not_authentic"),
        ]

    def test_full_lifecycle_requires_refinement_and_execute_is_idempotent(self) -> None:
        session = self.start()

        with self.assertRaises(InvalidSessionStateError):
            self.hermes.approve(session["session_id"])

        refined = self.hermes.handle_rejection(session["session_id"], self.reject_two())
        self.assertEqual(refined["status"], "refined_ready")
        self.assertEqual(refined["refined_direction"]["id"], 10)

        approved = self.hermes.approve(session["session_id"])
        self.assertEqual(approved["status"], "approved")

        executed = self.hermes.execute(session["session_id"])
        self.assertEqual(executed, self.hermes.execute(session["session_id"]))
        self.assertEqual(executed["status"], "executed")

    def test_rejection_requires_exactly_two_distinct_directions(self) -> None:
        cases = [
            [Rejection(direction_id=2, reason="too_loud")],
            [
                Rejection(direction_id=2, reason="too_loud"),
                Rejection(direction_id=2, reason="not_authentic"),
            ],
            [
                Rejection(direction_id=1, reason="too_generic"),
                Rejection(direction_id=2, reason="too_loud"),
                Rejection(direction_id=3, reason="not_authentic"),
            ],
        ]

        for rejections in cases:
            with self.subTest(rejections=rejections):
                with self.assertRaises(InvalidSessionStateError):
                    self.hermes.handle_rejection(self.start()["session_id"], rejections)

    def test_unknown_direction_does_not_mutate_session(self) -> None:
        session = self.start()
        unknown = [
            Rejection(direction_id=2, reason="too_loud"),
            Rejection(direction_id=999, reason="not_authentic"),
        ]

        with self.assertRaises(DirectionNotFoundError):
            self.hermes.handle_rejection(session["session_id"], unknown)

        unchanged = self.hermes.get_session(session["session_id"])
        self.assertEqual(unchanged["status"], "active")
        self.assertEqual(unchanged["rejections"], [])

    def test_rejection_after_refinement_is_invalid(self) -> None:
        session = self.start()
        self.hermes.handle_rejection(session["session_id"], self.reject_two())

        with self.assertRaises(InvalidSessionStateError):
            self.hermes.handle_rejection(session["session_id"], self.reject_two())

    def test_start_does_not_cache_session_when_create_fails(self) -> None:
        store = RecoverableSessionStore()
        store.fail_create = True
        hermes = Hermes(store=store)

        with self.assertRaisesRegex(RuntimeError, "create unavailable"):
            hermes.start_session("Acme", "A valid creative brief description.")

        self.assertIsNotNone(store.last_create_id)
        with self.assertRaises(SessionNotFoundError):
            hermes.get_session(store.last_create_id or "")

    def test_rejection_save_failure_leaves_active_session_retryable(self) -> None:
        store = RecoverableSessionStore()
        hermes = Hermes(store=store)
        session = hermes.start_session("Acme", "A valid creative brief description.")
        store.fail_save = True

        with self.assertRaisesRegex(RuntimeError, "save unavailable"):
            hermes.handle_rejection(session["session_id"], self.reject_two())

        unchanged = hermes.get_session(session["session_id"])
        self.assertEqual(unchanged["status"], "active")
        self.assertEqual(unchanged["rejections"], [])

        store.fail_save = False
        retried = hermes.handle_rejection(session["session_id"], self.reject_two())
        self.assertEqual(retried["status"], "refined_ready")

    def test_approve_save_failure_leaves_refined_session_retryable(self) -> None:
        store = RecoverableSessionStore()
        hermes = Hermes(store=store)
        session = hermes.start_session("Acme", "A valid creative brief description.")
        hermes.handle_rejection(session["session_id"], self.reject_two())
        store.fail_save = True

        with self.assertRaisesRegex(RuntimeError, "save unavailable"):
            hermes.approve(session["session_id"])

        self.assertEqual(hermes.get_session(session["session_id"])["status"], "refined_ready")
        store.fail_save = False
        self.assertEqual(hermes.approve(session["session_id"])["status"], "approved")

    def test_execute_save_failure_leaves_approved_session_retryable(self) -> None:
        store = RecoverableSessionStore()
        hermes = Hermes(store=store)
        session = hermes.start_session("Acme", "A valid creative brief description.")
        hermes.handle_rejection(session["session_id"], self.reject_two())
        hermes.approve(session["session_id"])
        store.fail_save = True

        with self.assertRaisesRegex(RuntimeError, "save unavailable"):
            hermes.execute(session["session_id"])

        unchanged = hermes.get_session(session["session_id"])
        self.assertEqual(unchanged["status"], "approved")
        self.assertIsNone(unchanged["artifact"])

        store.fail_save = False
        retried = hermes.execute(session["session_id"])
        self.assertEqual(retried["status"], "executed")
        self.assertEqual(store.get(session["session_id"])["status"], "executed")

        store.fail_save = True
        self.assertEqual(hermes.execute(session["session_id"]), retried)

    def test_approve_is_idempotent_after_approval_and_execution(self) -> None:
        session = self.start()
        self.hermes.handle_rejection(session["session_id"], self.reject_two())
        approved = self.hermes.approve(session["session_id"])

        self.assertEqual(self.hermes.approve(session["session_id"]), approved)
        self.hermes.execute(session["session_id"])
        self.assertEqual(self.hermes.approve(session["session_id"])["status"], "executed")


if __name__ == "__main__":
    unittest.main()
