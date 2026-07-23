from __future__ import annotations

from dataclasses import asdict

from app.core.types import ContentArtifact, CreativeSession
from app.llm.router import StructuredLlmRouter
from app.llm.schemas import ContentOutput
from app.llm.svg_renderer import SvgRenderer


SYSTEM_PROMPT = (
    "You are a content designer. Produce a caption, exactly three rationale points, and a "
    "structured layout specification grounded in the approved direction. Return structured output only."
)


class ContentAgent:
    def __init__(
        self, router: StructuredLlmRouter, renderer: SvgRenderer | None = None
    ) -> None:
        self._router = router
        self._renderer = renderer or SvgRenderer()

    def generate(self, user_id: str, session: CreativeSession) -> ContentArtifact:
        output = self._router.generate(
            user_id, ContentOutput, SYSTEM_PROMPT, {"session": asdict(session)}
        )
        return ContentArtifact(
            caption=output.caption,
            layout_mock_svg=self._renderer.render(session.brand_name, output.layout),
            rationale=output.rationale,
        )
