from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal


RejectionReason = Literal[
    "too_generic",
    "too_loud",
    "not_our_audience",
    "not_authentic",
    "other",
]


@dataclass(frozen=True)
class ToneSlider:
    label: str
    left: str
    right: str
    # visual-only for MVP (0..100)
    value: int


@dataclass(frozen=True)
class BrandDNA:
    beliefs: tuple[str, str, str]
    tone_sliders: tuple[ToneSlider, ToneSlider]


@dataclass(frozen=True)
class CreativeDirection:
    id: int
    name: str
    tone: str
    visual_style: str
    creative_intent: str
    palette: tuple[str, ...]
    channels: tuple[str, ...]
    why_it_works: str


@dataclass(frozen=True)
class Rejection:
    direction_id: int
    reason: RejectionReason
    note: str | None = None


@dataclass(frozen=True)
class ContentArtifact:
    caption: str
    layout_mock_svg: str
    rationale: tuple[str, str, str]


@dataclass
class CreativeSession:
    session_id: str
    user_id: str
    brand_name: str
    description: str
    goal: str | None
    reference: str | None
    dna: BrandDNA
    directions: list[CreativeDirection]
    round: int = 1
    status: str = "active"  # active | refined_ready | approved | executed
    rejections: list[Rejection] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    refined_direction: CreativeDirection | None = None
    artifact: ContentArtifact | None = None
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
    )
