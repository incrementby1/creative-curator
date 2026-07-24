from __future__ import annotations

from dataclasses import asdict

from app.core.types import BrandDNA, Rejection
from app.llm.router import StructuredLlmRouter
from app.llm.schemas import CriticOutput


SYSTEM_PROMPT = (
    "You are a constructive creative critic. Convert rejection reasons into specific, "
    "actionable constraints grounded in the brand. Return structured output only."
)


class CriticAgent:
    def __init__(self, router: StructuredLlmRouter) -> None:
        self._router = router

    def extract_constraints_structured(
        self, user_id: str, brand_name: str, description: str, goal: str | None,
        dna: BrandDNA, rejections: list[Rejection],
    ) -> list[str]:
        output = self._router.generate(
            user_id, CriticOutput, SYSTEM_PROMPT,
            {
                "brand_name": brand_name,
                "description": description,
                "goal": goal,
                "dna": asdict(dna),
                "rejections": [asdict(item) for item in rejections],
            },
        )
        return list(output.constraints)
