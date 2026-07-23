import unittest

from app.core.hermes import Hermes
from app.core.types import BrandDNA, ContentArtifact, CreativeDirection, Rejection, ToneSlider
from app.llm.types import AiConfigurationRequired, AllProvidersFailed, AttemptFailure
from app.persistence.session_store import InMemorySessionStore


USER = "user-a"


class Readiness:
    def __init__(self, configured: bool = True) -> None:
        self.configured = configured
        self.users: list[str] = []

    def require_configured(self, user_id: str) -> None:
        self.users.append(user_id)
        if not self.configured:
            raise AiConfigurationRequired()


class Agents:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.fail_on: str | None = None

    def _call(self, name: str, user_id: str):
        self.calls.append((name, user_id))
        if self.fail_on == name:
            raise AllProvidersFailed((AttemptFailure("openai", "timeout"),))

    def hypothesize(self, user_id: str, **_kwargs):
        self._call("dna", user_id)
        return BrandDNA(
            beliefs=("One", "Two", "Three"),
            tone_sliders=(ToneSlider("Energy", "Calm", "Bold", 50), ToneSlider("Voice", "Formal", "Casual", 50)),
        )

    def generate(self, user_id: str, *args, **kwargs):
        if args and hasattr(args[0], "session_id") or "session" in kwargs:
            self._call("content", user_id)
            return ContentArtifact("Caption", "<svg/>", ("One", "Two", "Three"))
        self._call("directions", user_id)
        return [
            CreativeDirection(i, f"Direction {i}", "Warm", "Clean", "Intent", ("#112233",), ("social",), "Fit")
            for i in range(1, 4)
        ]

    def extract_constraints_structured(self, user_id: str, **_kwargs):
        self._call("critic", user_id)
        return ["Stay specific"]

    def refine(self, user_id: str, **_kwargs):
        self._call("refine", user_id)
        return CreativeDirection(10, "Refined", "Warm", "Clean", "Intent", ("#112233",), ("social",), "Fit")


class HermesRoutingTests(unittest.TestCase):
    def make(self, configured: bool = True):
        store = InMemorySessionStore()
        readiness = Readiness(configured)
        agents = Agents()
        hermes = Hermes(
            store=store,
            readiness=readiness,
            dna_agent=agents,
            direction_agent=agents,
            critic_agent=agents,
            content_agent=agents,
        )
        return hermes, store, readiness, agents

    def start(self, hermes: Hermes) -> dict:
        return hermes.start_session(USER, "Acme", "A sufficiently detailed creative brief.")

    def test_start_without_routing_has_no_agent_store_or_cache_mutation(self) -> None:
        hermes, store, _readiness, agents = self.make(configured=False)

        with self.assertRaises(AiConfigurationRequired):
            self.start(hermes)

        self.assertEqual(agents.calls, [])
        self.assertEqual(store._sessions, {})
        self.assertEqual(hermes.cached_session_count, 0)

    def test_user_id_reaches_every_generative_agent_call(self) -> None:
        hermes, _store, _readiness, agents = self.make()
        session = self.start(hermes)
        rejects = [Rejection(2, "too_loud"), Rejection(3, "not_authentic")]
        hermes.handle_rejection(USER, session["session_id"], rejects)
        hermes.approve(USER, session["session_id"])
        hermes.execute(USER, session["session_id"])

        self.assertEqual(
            agents.calls,
            [("dna", USER), ("directions", USER), ("critic", USER), ("refine", USER), ("content", USER)],
        )

    def test_provider_failure_each_transition_is_retryable_without_mutation(self) -> None:
        hermes, _store, _readiness, agents = self.make()
        agents.fail_on = "dna"
        with self.assertRaises(AllProvidersFailed):
            self.start(hermes)
        self.assertEqual(hermes.cached_session_count, 0)
        agents.fail_on = None
        session = self.start(hermes)
        rejects = [Rejection(2, "too_loud"), Rejection(3, "not_authentic")]

        for operation in ("critic", "refine"):
            agents.fail_on = operation
            with self.assertRaises(AllProvidersFailed):
                hermes.handle_rejection(USER, session["session_id"], rejects)
            self.assertEqual(hermes.get_session(USER, session["session_id"])["status"], "active")
        agents.fail_on = None
        hermes.handle_rejection(USER, session["session_id"], rejects)
        hermes.approve(USER, session["session_id"])
        agents.fail_on = "content"
        with self.assertRaises(AllProvidersFailed):
            hermes.execute(USER, session["session_id"])
        self.assertEqual(hermes.get_session(USER, session["session_id"])["status"], "approved")
        agents.fail_on = None
        self.assertEqual(hermes.execute(USER, session["session_id"])["status"], "executed")


if __name__ == "__main__":
    unittest.main()
