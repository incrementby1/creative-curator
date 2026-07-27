from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("value must not be blank")
    return value


NonEmptyStr = Annotated[str, Field(strict=True, min_length=1, max_length=500), AfterValidator(_not_blank)]
ShortText = Annotated[str, Field(strict=True, min_length=1, max_length=120), AfterValidator(_not_blank)]


class StrictOutput(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True, extra="forbid")


class ProposedNodeOutput(StrictOutput):
    client_key: ShortText
    node_type: Literal["evidence", "assumption", "idea", "decision", "challenge"]
    title: ShortText
    content: NonEmptyStr
    rationale: NonEmptyStr
    dependencies: Annotated[tuple[ShortText, ...], Field(max_length=12)] | None = None
    confidence: Annotated[int, Field(strict=True, ge=0, le=100)] | None = None
    downstream_effect: NonEmptyStr | None = None

    @model_validator(mode="after")
    def challenge_metadata_is_structured(self) -> "ProposedNodeOutput":
        values = (self.dependencies, self.confidence, self.downstream_effect)
        if self.node_type == "challenge" and any(value is None for value in values):
            raise ValueError("challenge proposals require dependencies, confidence, and downstream effect")
        if self.node_type != "challenge" and any(value is not None for value in values):
            raise ValueError("challenge metadata is valid only for challenge proposals")
        return self


class ProposedEdgeOutput(StrictOutput):
    source_key: ShortText
    target_key: ShortText
    edge_type: Literal["supports", "contradicts", "depends_on", "inspires", "supersedes"]


class GraphAnalysisOutput(StrictOutput):
    summary: NonEmptyStr
    proposed_nodes: Annotated[tuple[ProposedNodeOutput, ...], Field(max_length=8)]
    proposed_edges: Annotated[tuple[ProposedEdgeOutput, ...], Field(max_length=12)]
    affected_node_ids: Annotated[tuple[ShortText, ...], Field(max_length=24)]
