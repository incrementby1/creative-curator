import unittest

import sys
from pathlib import Path

# Allow running tests from repo root (so `import app.*` resolves).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.hermes import Hermes, InvalidSessionStateError


class HermesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.hermes = Hermes()

    def test_session_can_be_started_and_revised(self) -> None:
        session = self.hermes.start_session(
            brand_name="Acme",
            description="A modern neighborhood coffee shop.",
            goal="Launch a new summer collection",
        )

        revised = self.hermes.handle_rejection(
            session["session_id"], ["Make it feel more editorial"]
        )

        self.assertEqual(revised["round"], 2)
        self.assertEqual(len(revised["directions"]), 3)
        self.assertIn("editorial", revised["directions"][0]["why_it_works"].lower())

    def test_approval_closes_the_session(self) -> None:
        session = self.hermes.start_session(
            brand_name="Acme",
            description="A subscription-first specialty bakery.",
            goal="Grow qualified newsletter signups",
        )

        result = self.hermes.approve(session["session_id"])

        self.assertEqual(result["status"], "approved")
        with self.assertRaises(InvalidSessionStateError):
            self.hermes.approve(session["session_id"])


if __name__ == "__main__":
    unittest.main()
