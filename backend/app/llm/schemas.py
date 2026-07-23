from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("value must not be blank")
    return value


NonEmptyStr = Annotated[str, Field(strict=True, min_length=1, max_length=500), AfterValidator(_not_blank)]
ShortText = Annotated[str, Field(strict=True, min_length=1, max_length=120), AfterValidator(_not_blank)]
HexColor = Annotated[str, Field(strict=True, pattern=r"^#[0-9A-Fa-f]{6}$")]
SliderValue = Annotated[int, Field(strict=True, ge=0, le=100)]


class StrictOutput(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True, extra="forbid")


class ToneSliderOutput(StrictOutput):
    label: ShortText
    left: ShortText
    right: ShortText
    value: SliderValue


class DnaOutput(StrictOutput):
    beliefs: tuple[NonEmptyStr, NonEmptyStr, NonEmptyStr]
    tone_sliders: tuple[ToneSliderOutput, ToneSliderOutput]


class DirectionSpec(StrictOutput):
    name: ShortText
    tone: NonEmptyStr
    visual_style: NonEmptyStr
    creative_intent: NonEmptyStr
    palette: Annotated[tuple[HexColor, ...], Field(min_length=1, max_length=8)]
    channels: Annotated[tuple[NonEmptyStr, ...], Field(min_length=1, max_length=12)]
    why_it_works: NonEmptyStr


class DirectionOutput(StrictOutput):
    directions: tuple[DirectionSpec, DirectionSpec, DirectionSpec]

    @model_validator(mode="after")
    def directions_must_be_distinct(self) -> "DirectionOutput":
        if len({item.name.casefold() for item in self.directions}) != 3:
            raise ValueError("direction names must be distinct")
        signatures = {
            (
                item.tone.casefold(),
                item.visual_style.casefold(),
                item.creative_intent.casefold(),
                item.palette,
                item.channels,
                item.why_it_works.casefold(),
            )
            for item in self.directions
        }
        if len(signatures) != 3:
            raise ValueError("directions must be distinct")
        return self


class RefinedDirectionOutput(StrictOutput):
    direction: DirectionSpec


class CriticOutput(StrictOutput):
    constraints: Annotated[tuple[NonEmptyStr, ...], Field(min_length=1, max_length=20)]


class ArtifactTextBlock(StrictOutput):
    text: Annotated[str, Field(strict=True, min_length=1, max_length=500), AfterValidator(_not_blank)]
    role: Literal["headline", "subheadline", "body", "eyebrow"]


class ArtifactLayoutSpec(StrictOutput):
    layout: Literal["poster", "split", "stacked"]
    palette: Annotated[tuple[HexColor, ...], Field(min_length=2, max_length=4)]
    text_blocks: Annotated[tuple[ArtifactTextBlock, ...], Field(min_length=1, max_length=6)]
    cta: ShortText


class ContentOutput(StrictOutput):
    caption: NonEmptyStr
    rationale: tuple[NonEmptyStr, NonEmptyStr, NonEmptyStr]
    layout: ArtifactLayoutSpec
