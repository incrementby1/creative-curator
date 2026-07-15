import unittest

from app.core.hermes import Hermes, InvalidSessionStateError


class HermesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.hermes = Hermes()

    def test_session_can_be_started_and_revised(self) -> None:
        session = self.hermes.start_session("Acme", "Launch a new summer collection")

        revised = self.hermes.handle_rejection(
            session["session_id"], ["Make it feel more editorial"]
        )

        self.assertEqual(revised["round"], 2)
        self.assertEqual(len(revised["directions"]), 3)
        self.assertIn("editorial", revised["directions"][0]["concept"])

    def test_approval_closes_the_session(self) -> None:
        session = self.hermes.start_session("Acme", "Grow qualified newsletter signups")

        result = self.hermes.deploy(session["session_id"], 2)

        self.assertEqual(result["status"], "approved")
        self.assertEqual(result["direction"]["id"], 2)
        with self.assertRaises(InvalidSessionStateError):
            self.hermes.deploy(session["session_id"], 1)


if __name__ == "__main__":
    unittest.main()
