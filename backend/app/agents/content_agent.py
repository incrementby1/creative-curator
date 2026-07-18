from __future__ import annotations

from app.core.types import ContentArtifact, CreativeSession


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
        headline = direction.name
        subhead = direction.creative_intent
        svg = f"""<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1080' viewBox='0 0 1080 1080'>
  <defs>
    <style>
      .h {{ font: 700 64px system-ui, -apple-system, Segoe UI, Roboto, Arial; fill: {direction.palette[0]}; }}
      .s {{ font: 400 34px system-ui, -apple-system, Segoe UI, Roboto, Arial; fill: {direction.palette[0]}; opacity: 0.86; }}
      .b {{ font: 400 30px system-ui, -apple-system, Segoe UI, Roboto, Arial; fill: {direction.palette[0]}; opacity: 0.82; }}
      .tag {{ font: 600 26px system-ui, -apple-system, Segoe UI, Roboto, Arial; fill: {direction.palette[0]}; opacity: 0.9; }}
    </style>
  </defs>
  <rect x='0' y='0' width='1080' height='1080' rx='48' fill='{direction.palette[1]}'/>
  <rect x='96' y='96' width='888' height='888' rx='40' fill='{direction.palette[1]}' stroke='{direction.palette[2] if len(direction.palette) > 2 else direction.palette[0]}' stroke-width='6'/>

  <text x='120' y='190' class='tag'>{brand.upper()}</text>
  <text x='120' y='285' class='h'>{headline}</text>
  <text x='120' y='350' class='s'>{subhead}</text>

  <text x='120' y='460' class='b'>Tone: {direction.tone}</text>
  <text x='120' y='520' class='b'>Visual: {direction.visual_style}</text>
  <text x='120' y='580' class='b'>Channels: {', '.join(direction.channels)}</text>

  <rect x='120' y='820' width='520' height='88' rx='22' fill='{direction.palette[2] if len(direction.palette) > 2 else direction.palette[0]}'/>
  <text x='160' y='875' class='tag' fill='{direction.palette[1]}'>VIEW MENU →</text>
</svg>"""

        rationale = (
            f"Intended emotional response: {direction.tone} — confident without trying too hard.",
            f"Why this fits {brand}: it aligns to your brand DNA and reinforces the goal ({goal}).",
            f"What we avoided due to rejection: {avoided or 'generic hype + off-audience cues.'}",
        )

        return ContentArtifact(caption=caption, layout_mock_svg=svg, rationale=rationale)
