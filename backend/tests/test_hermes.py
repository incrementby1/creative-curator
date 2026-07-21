import sys
import unittest
from pathlib import Path

# Allow running tests from repo root (so `import app.*` resolves).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.hermes import (
    DirectionNotFoundError,
    Hermes,
    InvalidSessionStateError,
)
from app.core.types import Rejection
from app.persistence.session_store import InMemorySessionStore


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


if __name__ == "__main__":
    unittest.main()
