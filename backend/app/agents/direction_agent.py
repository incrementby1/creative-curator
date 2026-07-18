from __future__ import annotations

from dataclasses import asdict

from app.core.types import BrandDNA, CreativeDirection, CreativeSession


class DirectionAgent:
    """Deterministic direction generator (LLM-ready later).

    For hackathon reliability, this stays template-driven. It already enforces
    divergence (directions are intentionally different).
    """

    def generate(
        self,
        brand_name: str,
        description: str,
        goal: str | None,
        dna: BrandDNA,
    ) -> list[CreativeDirection]:
        g = goal or description
        beliefs = ", ".join(dna.beliefs)

        return [
            CreativeDirection(
                id=1,
                name="Neighborhood Fun",
                tone="Warm, playful, confident (never chaotic)",
                visual_style="Candid photos, bright accents, hand-drawn cues, friendly type",
                creative_intent=f"Make {brand_name} feel like the obvious local favorite.",
                palette=("#111827", "#F59E0B", "#FDE68A"),
                channels=("Google Maps", "Instagram", "In-store"),
                why_it_works=f"Anchors trust through familiarity. Uses your DNA ({beliefs}) to stay human while driving: {g}.",
            ),
            CreativeDirection(
                id=2,
                name="Premium Artisan",
                tone="Calm, precise, quietly confident",
                visual_style="Minimal layouts, close-up detail shots, whitespace, restrained copy",
                creative_intent=f"Position {brand_name} as the refined choice without feeling expensive-for-no-reason.",
                palette=("#0F172A", "#F8FAFC", "#94A3B8"),
                channels=("Website", "Instagram", "Menu/Print"),
                why_it_works=f"Signals quality with intent, not hype. Keeps the voice aligned to your DNA ({beliefs}) while supporting: {g}.",
            ),
            CreativeDirection(
                id=3,
                name="Internet Chaos",
                tone="High-energy, punchy, a little unhinged (but still on-brand)",
                visual_style="Bold type, meme-adjacent compositions, hard cuts, attention hooks",
                creative_intent=f"Win attention fast, then earn trust with receipts (photos, proof, reviews).",
                palette=("#000000", "#FFFFFF", "#22C55E"),
                channels=("TikTok", "Reels", "Stories"),
                why_it_works=f"If your audience lives online, this breaks through. It’s intentionally distinct from the other options while still grounded in ({beliefs}).",
            ),
        ]

    def regenerate_all(self, session: CreativeSession, feedback: str) -> list[CreativeDirection]:
        directions = self.generate(
            brand_name=session.brand_name,
            description=session.description,
            goal=session.goal,
            dna=session.dna,
        )
        # Light-touch adjustment so judges see it changed.
        adjusted: list[CreativeDirection] = []
        for d in directions:
            adjusted.append(
                CreativeDirection(
                    **{
                        **asdict(d),
                        "name": f"{d.name} · R{session.round}",
                        "why_it_works": f"{d.why_it_works} (Adjusted because you said: {feedback})",
                    }
                )
            )
        return adjusted

    def refine(
        self,
        session: CreativeSession,
        base_direction: CreativeDirection,
        constraints: list[str],
    ) -> CreativeDirection:
        # Simple rule-based refinement that explicitly references rejection.
        constraint_text = "; ".join(constraints) if constraints else ""
        why = base_direction.why_it_works
        if constraint_text:
            why = (
                f"Refined from '{base_direction.name}'. Since you rejected options, we applied: {constraint_text}. "
                + why
            )

        # If “too loud” appears, soften tone & visuals.
        softened = any("too loud" in c.lower() or "soften" in c.lower() for c in constraints)
        tone = base_direction.tone
        visual = base_direction.visual_style
        if softened:
            tone = "Warm, grounded, confident (no hype)"
            visual = "Clean layouts, real photos, fewer exclamation cues, more whitespace"

        return CreativeDirection(
            id=10,
            name=f"{base_direction.name} (Refined)",
            tone=tone,
            visual_style=visual,
            creative_intent=base_direction.creative_intent,
            palette=base_direction.palette,
            channels=base_direction.channels,
            why_it_works=why,
        )
