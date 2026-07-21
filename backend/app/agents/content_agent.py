from __future__ import annotations

import re
from xml.sax.saxutils import escape

from app.core.types import ContentArtifact, CreativeSession


HEX_COLOR = re.compile(r"#[0-9A-Fa-f]{6}")


def svg_text(value: object) -> str:
    xml_safe = "".join(
        character
        for character in str(value)
        if character in "\t\n\r"
        or 0x20 <= ord(character) <= 0xD7FF
        or 0xE000 <= ord(character) <= 0xFFFD
        or 0x10000 <= ord(character) <= 0x10FFFF
    )
    return escape(xml_safe, {'"': '&quot;', "'": '&apos;'})


def svg_value(value: object) -> str:
    return svg_text(value).replace("=", "&#61;")


def svg_color(value: object) -> str:
    color = str(value)
    if not HEX_COLOR.fullmatch(color):
        raise ValueError(f"Unsupported palette color: {color!r}")
    return svg_value(color)


class ContentAgent:
    """Generates a single on-brand content artifact (caption + layout mock + rationale)."""

    def generate(self, session: CreativeSession) -> ContentArtifact:
        direction = session.refined_direction or session.directions[0]
        brand = session.brand_name
        goal = session.goal or session.description

        avoided = " / ".join(
            [c for c in session.constraints if c.lower().startswith("avoid")][:2]
        )
        if not avoided and session.constraints:
            avoided = session.constraints[0]

        caption = (
            f"{brand} — {direction.creative_intent}\n\n"
            f"Today’s focus: {goal}.\n"
            f"{direction.tone}.\n\n"
            "What you’ll notice:\n"
            "• Real details, real proof\n"
            "• A clear next step\n\n"
            "Want this for your business? Tap to learn more."
        )

        # Minimal layout mock as SVG (safe to render in browser).
        brand_svg = svg_value(brand.upper())
        headline = svg_value(direction.name)
        subhead = svg_value(direction.creative_intent)
        tone = svg_value(direction.tone)
        visual_style = svg_value(direction.visual_style)
        channels = svg_value(", ".join(direction.channels))
        palette = tuple(svg_color(value) for value in direction.palette)
        primary = palette[0]
        background = palette[1]
        accent = palette[2] if len(palette) > 2 else primary
        svg = f"""<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1080' viewBox='0 0 1080 1080'>
  <defs>
    <style>
      .h {{ font: 700 64px system-ui, -apple-system, Segoe UI, Roboto, Arial; fill: {primary}; }}
      .s {{ font: 400 34px system-ui, -apple-system, Segoe UI, Roboto, Arial; fill: {primary}; opacity: 0.86; }}
      .b {{ font: 400 30px system-ui, -apple-system, Segoe UI, Roboto, Arial; fill: {primary}; opacity: 0.82; }}
      .tag {{ font: 600 26px system-ui, -apple-system, Segoe UI, Roboto, Arial; fill: {primary}; opacity: 0.9; }}
    </style>
  </defs>
  <rect x='0' y='0' width='1080' height='1080' rx='48' fill='{background}'/>
  <rect x='96' y='96' width='888' height='888' rx='40' fill='{background}' stroke='{accent}' stroke-width='6'/>

  <text x='120' y='190' class='tag'>{brand_svg}</text>
  <text x='120' y='285' class='h'>{headline}</text>
  <text x='120' y='350' class='s'>{subhead}</text>

  <text x='120' y='460' class='b'>Tone: {tone}</text>
  <text x='120' y='520' class='b'>Visual: {visual_style}</text>
  <text x='120' y='580' class='b'>Channels: {channels}</text>

  <rect x='120' y='820' width='520' height='88' rx='22' fill='{accent}'/>
  <text x='160' y='875' class='tag' fill='{background}'>VIEW MENU →</text>
</svg>"""

        rationale = (
            f"Intended emotional response: {direction.tone} — confident without trying too hard.",
            f"Why this fits {brand}: it aligns to your brand DNA and reinforces the goal ({goal}).",
            f"What we avoided due to rejection: {avoided or 'generic hype + off-audience cues.'}",
        )

        return ContentArtifact(caption=caption, layout_mock_svg=svg, rationale=rationale)
