from __future__ import annotations

from app.core.types import BrandDNA, ToneSlider


class DnaAgent:
    """Extracts a first-guess brand DNA hypothesis.

MVP: deterministic + friendly wording. (Can be LLM-backed later.)
"""

    def hypothesize(
        self,
        brand_name: str,
        description: str,
        goal: str | None = None,
        reference: str | None = None,
    ) -> BrandDNA:
        # Minimal heuristics; designed to invite correction.
        desc = description.strip().rstrip(".")
        g = (goal or "").strip()
        ref = (reference or "").strip()

        belief_1 = f"We respect the customer’s time (clear, helpful, no fluff)."
        belief_2 = f"Quality should feel intentional, not accidental."
        vibe = "friendly" if "friendly" in desc.lower() else "warm"
        belief_3 = f"We’re {vibe} but confident — never trying too hard."

        if g:
            belief_2 = f"Everything should reinforce one outcome: {g}"
        if ref:
            belief_1 = f"We should feel like: {ref[:80]}"

        sliders = (
            ToneSlider(label="Energy", left="Calm", right="Bold", value=55),
            ToneSlider(label="Voice", left="Formal", right="Casual", value=60),
        )
        return BrandDNA(beliefs=(belief_1, belief_2, belief_3), tone_sliders=sliders)
