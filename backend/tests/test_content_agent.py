import sys
import unittest
import xml.etree.ElementTree as ElementTree
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.content_agent import ContentAgent
from app.core.types import BrandDNA, CreativeDirection, CreativeSession, ToneSlider
from app.llm.schemas import ArtifactLayoutSpec, ArtifactTextBlock, ContentOutput
from app.llm.svg_renderer import SvgRenderer


class FakeRouter:
    def __init__(self, output):
        self.output = output
        self.calls = []

    def generate(self, user_id, output_model, system_prompt, user_json):
        self.calls.append((user_id, output_model, system_prompt, user_json))
        return self.output


def make_session(brand_name="Acme"):
    direction = CreativeDirection(
        10, "Quiet Craft", "Warm", "Editorial", "Show the care",
        ("#112233", "#F5F5F5", "#DDAA22"), ("Instagram",), "Fits the DNA",
    )
    return CreativeSession(
        "s1", "user-a", brand_name, "Bakery", "Launch", None,
        BrandDNA(
            ("Care", "Craft", "Welcome"),
            (ToneSlider("Energy", "Calm", "Bold", 40), ToneSlider("Voice", "Formal", "Casual", 60)),
        ),
        [direction], refined_direction=direction, constraints=["Avoid hype"], status="approved",
    )


def output(text="Fresh bread", color="#112233", layout="poster", palette=None):
    return ContentOutput(
        caption="A considered launch.",
        rationale=("Fits the tone", "Shows proof", "Avoids hype"),
        layout=ArtifactLayoutSpec(
            layout=layout,
            palette=palette or (color, "#FFFFFF", "#DDAA22"),
            text_blocks=(
                ArtifactTextBlock(text=text, role="headline"),
                ArtifactTextBlock(text="Made today", role="body"),
            ),
            cta="View menu",
        ),
    )


class ContentAgentTests(unittest.TestCase):
    def test_content_agent_requests_structured_layout_not_raw_svg(self):
        router = FakeRouter(output())
        artifact = ContentAgent(router, SvgRenderer()).generate("user-a", make_session())
        self.assertEqual(router.calls[0][1], ContentOutput)
        self.assertNotIn("svg", router.calls[0][3])
        self.assertNotIn("SVG", router.calls[0][2])
        self.assertEqual(artifact.caption, "A considered launch.")
        ElementTree.fromstring(artifact.layout_mock_svg)

    def test_renderer_escapes_hostile_model_and_brand_text(self):
        hostile = '</text><script>alert(1)</script><image onerror="bad">\x01'
        router = FakeRouter(output(hostile))
        artifact = ContentAgent(router, SvgRenderer()).generate("user-a", make_session(hostile))
        svg = artifact.layout_mock_svg
        parsed = ElementTree.fromstring(svg)
        tags = {element.tag.rsplit("}", 1)[-1] for element in parsed.iter()}
        self.assertNotIn("script", tags)
        self.assertNotIn("image", tags)
        self.assertNotIn("onerror=", svg.lower())
        self.assertNotIn("\x01", svg)
        self.assertIn("&lt;/text&gt;", svg)

    def test_renderer_revalidates_palette_and_does_not_trust_constructed_models(self):
        spec = output().layout
        object.__setattr__(spec, "palette", ("red; } script {", "#FFFFFF"))
        with self.assertRaisesRegex(ValueError, "Unsupported palette color"):
            SvgRenderer().render("Acme", spec)

    def test_renderer_input_alias_cannot_mutate_rendered_spec(self):
        blocks = [{"text": "Original", "role": "headline"}]
        spec = ArtifactLayoutSpec.model_validate({
            "layout": "poster", "palette": ("#112233", "#FFFFFF"),
            "text_blocks": tuple(blocks), "cta": "Go",
        })
        blocks[0]["text"] = "Mutated"
        svg = SvgRenderer().render("Acme", spec)
        self.assertIn("Original", svg)
        self.assertNotIn("Mutated", svg)

    def test_renderer_wraps_normal_and_unbroken_copy_without_losing_text(self):
        normal = (
            "Daryll's Coffee isn't a beverage. It's a consequence with a lid. "
            "Stay unpredictable and make the ordinary feel dangerous."
        )
        unbroken = "W" * 198
        spec = ArtifactLayoutSpec(
            layout="poster",
            palette=("#112233", "#FFFFFF", "#DDAA22"),
            text_blocks=(
                ArtifactTextBlock(text=normal, role="body"),
                ArtifactTextBlock(text=unbroken, role="body"),
            ),
            cta="View menu",
        )

        root = ElementTree.fromstring(SvgRenderer().render("Acme", spec))
        text_elements = [element for element in root if element.tag.endswith("text")]
        rendered_blocks = text_elements[1:3]

        self.assertTrue(all(len(list(element)) > 1 for element in rendered_blocks))
        self.assertEqual("".join(rendered_blocks[0].itertext()), normal)
        self.assertEqual("".join(rendered_blocks[1].itertext()), unbroken)
        self.assertTrue(all(len(row.text or "") <= 27 for row in rendered_blocks[1]))

    def test_allowlisted_layouts_produce_distinct_fixed_structures(self):
        structures = {}
        for layout in ("poster", "split", "stacked"):
            svg = SvgRenderer().render("Acme", output(layout=layout).layout)
            root = ElementTree.fromstring(svg)
            structures[layout] = tuple(
                (element.tag.rsplit("}", 1)[-1], element.get("x"), element.get("y"), element.get("width"), element.get("height"))
                for element in root
            )
            self.assertTrue(
                {item.tag.rsplit("}", 1)[-1] for item in root.iter()}
                <= {"svg", "rect", "text", "tspan"}
            )
        self.assertEqual(len(set(structures.values())), 3)

    def test_two_color_dark_palette_keeps_all_text_and_cta_contrasting(self):
        for layout in ("poster", "split", "stacked"):
            with self.subTest(layout=layout):
                svg = SvgRenderer().render(
                    "Acme", output(layout=layout, palette=("#101010", "#202020")).layout
                )
                root = ElementTree.fromstring(svg)
                elements = list(root)
                texts = [item for item in elements if item.tag.endswith("text")]
                rects = [item for item in elements if item.tag.endswith("rect")]
                self.assertTrue(texts)
                self.assertTrue(all(item.get("fill") == "#FFFFFF" for item in texts))
                self.assertNotEqual(texts[0].get("fill"), rects[0].get("fill"))
                self.assertNotEqual(texts[-1].get("fill"), rects[-1].get("fill"))


if __name__ == "__main__":
    unittest.main()
