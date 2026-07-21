import sys
import unittest
from pathlib import Path

# Allow running tests from repo root (so `import app.*` resolves).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.hermes import Hermes
from app.core.types import Rejection
from app.persistence.session_store import InMemorySessionStore


class ContentAgentTests(unittest.TestCase):
    def test_layout_svg_escapes_hostile_brand_markup(self) -> None:
        hermes = Hermes(store=InMemorySessionStore())
        session = hermes.start_session(
            brand_name='Bad </text><image href="x" onerror="alert(1)">',
            description="A modern neighborhood coffee shop with seasonal drinks.",
            goal="Launch a new summer collection",
        )

        hermes.handle_rejection(
            session["session_id"],
            [
                Rejection(direction_id=2, reason="too_loud"),
                Rejection(direction_id=3, reason="not_authentic"),
            ],
        )
        hermes.approve(session["session_id"])
        executed = hermes.execute(session["session_id"])

        svg = executed["artifact"]["layout_mock_svg"].lower()
        self.assertNotIn("<image", svg)
        self.assertNotIn("onerror=", svg)
        self.assertIn("&lt;/text&gt;", svg)


if __name__ == "__main__":
    unittest.main()
