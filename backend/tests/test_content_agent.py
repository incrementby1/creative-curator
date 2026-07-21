import sys
import unittest
import xml.etree.ElementTree as ElementTree
from dataclasses import replace
from pathlib import Path

# Allow running tests from repo root (so `import app.*` resolves).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.hermes import Hermes
from app.core.types import Rejection
from app.persistence.session_store import InMemorySessionStore


class ContentAgentTests(unittest.TestCase):
    @staticmethod
    def approved_hermes(brand_name: str) -> tuple[Hermes, str]:
        hermes = Hermes(store=InMemorySessionStore())
        session = hermes.start_session(
            "user-a",
            brand_name=brand_name,
            description="A modern neighborhood coffee shop with seasonal drinks.",
            goal="Launch a new summer collection",
        )
        session_id = session["session_id"]
        hermes.handle_rejection(
            "user-a",
            session_id,
            [
                Rejection(direction_id=2, reason="too_loud"),
                Rejection(direction_id=3, reason="not_authentic"),
            ],
        )
        hermes.approve("user-a", session_id)
        return hermes, session_id

    def test_layout_svg_escapes_hostile_brand_markup(self) -> None:
        hermes, session_id = self.approved_hermes(
            'Bad </text><image href="x" onerror="alert(1)">'
        )
        executed = hermes.execute("user-a", session_id)

        svg = executed["artifact"]["layout_mock_svg"].lower()
        self.assertNotIn("<image", svg)
        self.assertNotIn("onerror=", svg)
        self.assertIn("&lt;/text&gt;", svg)

    def test_layout_svg_rejects_unsafe_palette_value(self) -> None:
        hermes, session_id = self.approved_hermes("Acme")
        session = hermes._sessions[("user-a", session_id)]
        assert session.refined_direction is not None
        session.refined_direction = replace(
            session.refined_direction,
            palette=("red; } body { display: none; } .h { fill: red", "#F59E0B"),
        )

        with self.assertRaisesRegex(ValueError, "Unsupported palette color"):
            hermes.execute("user-a", session_id)

    def test_layout_svg_removes_xml_forbidden_control_characters(self) -> None:
        hermes, session_id = self.approved_hermes("Bad\x01Brand")

        svg = hermes.execute("user-a", session_id)["artifact"]["layout_mock_svg"]

        ElementTree.fromstring(svg)


if __name__ == "__main__":
    unittest.main()
