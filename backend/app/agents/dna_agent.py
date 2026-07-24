from __future__ import annotations

from app.core.types import BrandDNA, ToneSlider
from app.llm.router import StructuredLlmRouter
from app.llm.schemas import DnaOutput


SYSTEM_PROMPT = (
    "You are a brand strategist. Infer a concise brand DNA with exactly three beliefs "
    "and exactly two labeled tone sliders. Return only the requested structured output."
)


class DnaAgent:
    def __init__(self, router: StructuredLlmRouter) -> None:
        self._router = router

    def hypothesize(
        self,
        user_id: str,
        brand_name: str,
        description: str,
        goal: str | None = None,
        reference: str | None = None,
    ) -> BrandDNA:
        output = self._router.generate(
            user_id,
            DnaOutput,
            SYSTEM_PROMPT,
            {
                "brand_name": brand_name,
                "description": description,
                "goal": goal,
                "reference": reference,
            },
        )
        return BrandDNA(
            beliefs=output.beliefs,
            tone_sliders=tuple(
                ToneSlider(item.label, item.left, item.right, item.value)
                for item in output.tone_sliders
            ),
        )
