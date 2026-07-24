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
from tests.test_hermes_routing import Agents, Readiness

USER_ID = "user-a"


def make_hermes(store: InMemorySessionStore) -> Hermes:
    agents = Agents()
    return Hermes(
        store=store,
        readiness=Readiness(),
        dna_agent=agents,
        direction_agent=agents,
        critic_agent=agents,
        content_agent=agents,
    )


class RecoverableSessionStore(InMemorySessionStore):
    def __init__(self) -> None:
        super().__init__()
        self.fail_create = False
        self.fail_save = False
        self.last_create_id: str | None = None

    def create(self, user_id: str, session_id: str, state: dict) -> None:
        self.last_create_id = session_id
        if self.fail_create:
            raise RuntimeError("create unavailable")
        super().create(user_id, session_id, state)

    def save(self, user_id: str, session_id: str, state: dict) -> None:
        if self.fail_save:
            raise RuntimeError("save unavailable")
        super().save(user_id, session_id, state)


class HermesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.hermes = make_hermes(InMemorySessionStore())

    def start(self) -> dict:
        return self.hermes.start_session(
            user_id=USER_ID,
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
            self.hermes.approve(USER_ID, session["session_id"])

        refined = self.hermes.handle_rejection(USER_ID, session["session_id"], self.reject_two())
        self.assertEqual(refined["status"], "refined_ready")
        self.assertEqual(refined["refined_direction"]["id"], 10)

        approved = self.hermes.approve(USER_ID, session["session_id"])
        self.assertEqual(approved["status"], "approved")

        executed = self.hermes.execute(USER_ID, session["session_id"])
        self.assertEqual(executed, self.hermes.execute(USER_ID, session["session_id"]))
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
                    self.hermes.handle_rejection(USER_ID, self.start()["session_id"], rejections)

    def test_unknown_direction_does_not_mutate_session(self) -> None:
        session = self.start()
        unknown = [
            Rejection(direction_id=2, reason="too_loud"),
            Rejection(direction_id=999, reason="not_authentic"),
        ]

        with self.assertRaises(DirectionNotFoundError):
            self.hermes.handle_rejection(USER_ID, session["session_id"], unknown)

        unchanged = self.hermes.get_session(USER_ID, session["session_id"])
        self.assertEqual(unchanged["status"], "active")
        self.assertEqual(unchanged["rejections"], [])

    def test_rejection_after_refinement_is_invalid(self) -> None:
        session = self.start()
        self.hermes.handle_rejection(USER_ID, session["session_id"], self.reject_two())

        with self.assertRaises(InvalidSessionStateError):
            self.hermes.handle_rejection(USER_ID, session["session_id"], self.reject_two())

    def test_mutation_bypasses_stale_cache_and_honors_persisted_state(self) -> None:
        store = InMemorySessionStore()
        hermes = make_hermes(store)
        session = hermes.start_session(
            USER_ID, "Acme", "A sufficiently detailed creative brief."
        )
        session_id = session["session_id"]
        self.assertEqual(hermes.get_session(USER_ID, session_id)["status"], "active")

        persisted = store.get(USER_ID, session_id)
        assert persisted is not None
        persisted["status"] = "approved"
        store.save(USER_ID, session_id, persisted)

        with self.assertRaises(InvalidSessionStateError):
            hermes.handle_rejection(USER_ID, session_id, self.reject_two())

        self.assertEqual(store.get(USER_ID, session_id)["status"], "approved")

    def test_start_does_not_cache_session_when_create_fails(self) -> None:
        store = RecoverableSessionStore()
        store.fail_create = True
        hermes = make_hermes(store)

        with self.assertRaisesRegex(RuntimeError, "create unavailable"):
            hermes.start_session(USER_ID, "Acme", "A valid creative brief description.")

        self.assertIsNotNone(store.last_create_id)
        with self.assertRaises(SessionNotFoundError):
            hermes.get_session(USER_ID, store.last_create_id or "")

    def test_rejection_save_failure_leaves_active_session_retryable(self) -> None:
        store = RecoverableSessionStore()
        hermes = make_hermes(store)
        session = hermes.start_session(USER_ID, "Acme", "A valid creative brief description.")
        store.fail_save = True

        with self.assertRaisesRegex(RuntimeError, "save unavailable"):
            hermes.handle_rejection(USER_ID, session["session_id"], self.reject_two())

        unchanged = hermes.get_session(USER_ID, session["session_id"])
        self.assertEqual(unchanged["status"], "active")
        self.assertEqual(unchanged["rejections"], [])

        store.fail_save = False
        retried = hermes.handle_rejection(USER_ID, session["session_id"], self.reject_two())
        self.assertEqual(retried["status"], "refined_ready")

    def test_approve_save_failure_leaves_refined_session_retryable(self) -> None:
        store = RecoverableSessionStore()
        hermes = make_hermes(store)
        session = hermes.start_session(USER_ID, "Acme", "A valid creative brief description.")
        hermes.handle_rejection(USER_ID, session["session_id"], self.reject_two())
        store.fail_save = True

        with self.assertRaisesRegex(RuntimeError, "save unavailable"):
            hermes.approve(USER_ID, session["session_id"])

        self.assertEqual(hermes.get_session(USER_ID, session["session_id"])["status"], "refined_ready")
        store.fail_save = False
        self.assertEqual(hermes.approve(USER_ID, session["session_id"])["status"], "approved")

    def test_execute_save_failure_leaves_approved_session_retryable(self) -> None:
        store = RecoverableSessionStore()
        hermes = make_hermes(store)
        session = hermes.start_session(USER_ID, "Acme", "A valid creative brief description.")
        hermes.handle_rejection(USER_ID, session["session_id"], self.reject_two())
        hermes.approve(USER_ID, session["session_id"])
        store.fail_save = True

        with self.assertRaisesRegex(RuntimeError, "save unavailable"):
            hermes.execute(USER_ID, session["session_id"])

        unchanged = hermes.get_session(USER_ID, session["session_id"])
        self.assertEqual(unchanged["status"], "approved")
        self.assertIsNone(unchanged["artifact"])

        store.fail_save = False
        retried = hermes.execute(USER_ID, session["session_id"])
        self.assertEqual(retried["status"], "executed")
        self.assertEqual(store.get(USER_ID, session["session_id"])["status"], "executed")

        store.fail_save = True
        self.assertEqual(hermes.execute(USER_ID, session["session_id"]), retried)

    def test_approve_is_idempotent_after_approval_and_execution(self) -> None:
        session = self.start()
        self.hermes.handle_rejection(USER_ID, session["session_id"], self.reject_two())
        approved = self.hermes.approve(USER_ID, session["session_id"])

        self.assertEqual(self.hermes.approve(USER_ID, session["session_id"]), approved)
        self.hermes.execute(USER_ID, session["session_id"])
        self.assertEqual(self.hermes.approve(USER_ID, session["session_id"])["status"], "executed")

    def test_user_cannot_load_another_users_session(self) -> None:
        store = InMemorySessionStore()
        store.create("user-a", "session-1", {"session_id": "session-1"})

        self.assertIsNone(store.get("user-b", "session-1"))

    def test_save_cannot_overwrite_another_users_session(self) -> None:
        store = InMemorySessionStore()
        store.create("user-a", "session-1", {"status": "active"})

        store.save("user-b", "session-1", {"status": "approved"})

        self.assertEqual(store.get("user-a", "session-1"), {"status": "active"})
        self.assertEqual(store.get("user-b", "session-1"), {"status": "approved"})

    def test_hermes_hides_foreign_session(self) -> None:
        store = InMemorySessionStore()
        hermes = make_hermes(store)
        session = hermes.start_session(
            "user-a", "Acme", "A sufficiently detailed brief."
        )

        with self.assertRaises(SessionNotFoundError):
            hermes.get_session("user-b", session["session_id"])

    def test_hermes_rejects_corrupted_embedded_owner_without_caching(self) -> None:
        store = InMemorySessionStore()
        hermes = make_hermes(store)
        session = hermes.start_session(
            "user-a", "Acme", "A sufficiently detailed brief."
        )
        session_id = session["session_id"]
        corrupted = store.get("user-a", session_id)
        assert corrupted is not None
        corrupted["user_id"] = "user-b"
        store.save("user-a", session_id, corrupted)
        hermes._sessions.clear()

        with self.assertRaises(SessionNotFoundError):
            hermes.get_session("user-a", session_id)

        self.assertNotIn(("user-a", session_id), hermes._sessions)


if __name__ == "__main__":
    unittest.main()
