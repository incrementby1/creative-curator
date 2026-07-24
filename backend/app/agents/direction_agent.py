from __future__ import annotations

from dataclasses import asdict

from app.core.types import BrandDNA, CreativeDirection, CreativeSession
from app.llm.router import StructuredLlmRouter
from app.llm.schemas import DirectionOutput, DirectionSpec, RefinedDirectionOutput


GENERATE_PROMPT = (
    "You are a creative director. Produce exactly three meaningfully distinct creative "
    "directions grounded in the supplied brand context. Return structured output only."
)
REGENERATE_PROMPT = (
    "You are a creative director revising a full set. Produce exactly three meaningfully "
    "distinct new directions using the feedback and session context. Return structured output only."
)
REFINE_PROMPT = (
    "You are a creative director refining one selected direction. Apply every supplied "
    "constraint without losing the brand foundation. Return one structured direction only."
)


def _domain_direction(identifier: int, item: DirectionSpec) -> CreativeDirection:
    return CreativeDirection(
        id=identifier,
        name=item.name,
        tone=item.tone,
        visual_style=item.visual_style,
        creative_intent=item.creative_intent,
        palette=item.palette,
        channels=item.channels,
        why_it_works=item.why_it_works,
    )


class DirectionAgent:
    def __init__(self, router: StructuredLlmRouter) -> None:
        self._router = router

    def generate(
        self, user_id: str, brand_name: str, description: str, goal: str | None, dna: BrandDNA
    ) -> list[CreativeDirection]:
        output = self._router.generate(
            user_id, DirectionOutput, GENERATE_PROMPT,
            {"brand_name": brand_name, "description": description, "goal": goal, "dna": asdict(dna)},
        )
        return [_domain_direction(index, item) for index, item in enumerate(output.directions, 1)]

    def regenerate_all(
        self, user_id: str, session: CreativeSession, feedback: str
    ) -> list[CreativeDirection]:
        output = self._router.generate(
            user_id, DirectionOutput, REGENERATE_PROMPT,
            {"session": asdict(session), "feedback": feedback},
        )
        return [_domain_direction(index, item) for index, item in enumerate(output.directions, 1)]

    def refine(
        self, user_id: str, session: CreativeSession,
        base_direction: CreativeDirection, constraints: list[str],
    ) -> CreativeDirection:
        output = self._router.generate(
            user_id, RefinedDirectionOutput, REFINE_PROMPT,
            {"session": asdict(session), "base_direction": asdict(base_direction), "constraints": list(constraints)},
        )
        return _domain_direction(10, output.direction)
