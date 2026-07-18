from __future__ import annotations

from app.core.types import BrandDNA, Rejection


class CriticAgent:
    """Turns rejection into usable creative constraints.

This is prompt-conditioning signal (not ML training). Kept deterministic for MVP.
"""

    def extract_constraints_structured(
        self,
        brand_name: str,
        description: str,
        goal: str | None,
        dna: BrandDNA,
        rejections: list[Rejection],
    ) -> list[str]:
        constraints: list[str] = []
        for r in rejections:
            if r.reason == "too_generic":
                constraints.append(
                    "Avoid generic marketing language; use concrete details (menu items, pricing cues, specific moments)."
                )
            elif r.reason == "too_loud":
                constraints.append(
                    "Soften tone: fewer superlatives, no shouty hooks, prioritize warmth over hype."
                )
            elif r.reason == "not_our_audience":
                constraints.append(
                    "Align to the intended audience; remove cues that attract the wrong crowd."
                )
            elif r.reason == "not_authentic":
                constraints.append(
                    "Increase authenticity: grounded voice, avoid exaggerated claims, speak like the owner/team."
                )
            elif r.reason == "other":
                constraints.append("Honor the user's correction and adjust accordingly.")
            if r.note:
                constraints.append(f"User note: {r.note}")

        # A little brand anchoring so the refinement doesn't drift.
        constraints.append(f"Keep core beliefs: {', '.join(dna.beliefs)}")
        if goal:
            constraints.append(f"Stay focused on the outcome: {goal}")
        constraints.append(f"Brand: {brand_name}. One-line description: {description}")
        return constraints
