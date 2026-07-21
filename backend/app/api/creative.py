from __future__ import annotations

import os
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints

from app.core.hermes import (
    DirectionNotFoundError,
    Hermes,
    InvalidSessionStateError,
    SessionNotFoundError,
    hermes,
)
from app.core.types import Rejection

router = APIRouter(tags=["creative"])

# Transitional memory-only owner until request authentication supplies identity.
TRANSITIONAL_MEMORY_USER_ID = "00000000-0000-4000-8000-000000000001"

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
SessionStatus = Literal["active", "refined_ready", "approved", "executed"]
RejectionReason = Literal[
    "too_generic",
    "too_loud",
    "not_our_audience",
    "not_authentic",
    "other",
]


class ToneSliderResponse(BaseModel):
    label: str
    left: str
    right: str
    value: int


class BrandDnaResponse(BaseModel):
    beliefs: tuple[str, str, str]
    tone_sliders: tuple[ToneSliderResponse, ToneSliderResponse]


class DirectionResponse(BaseModel):
    id: int
    name: str
    tone: str
    visual_style: str
    creative_intent: str
    palette: list[str]
    channels: list[str]
    why_it_works: str


class RejectionModel(BaseModel):
    direction_id: int = Field(ge=1)
    reason: RejectionReason
    note: NonEmptyString | None = Field(default=None, max_length=240)


class ArtifactResponse(BaseModel):
    caption: str
    layout_mock_svg: str
    rationale: tuple[str, str, str]


class CreativeSessionResponse(BaseModel):
    session_id: str
    brand_name: str
    description: str
    goal: str | None
    reference: str | None
    dna: BrandDnaResponse
    directions: list[DirectionResponse]
    round: int
    status: SessionStatus
    rejections: list[RejectionModel]
    constraints: list[str]
    refined_direction: DirectionResponse | None
    artifact: ArtifactResponse | None
    updated_at: str


class ExecuteResponse(BaseModel):
    session_id: str
    status: Literal["executed"]
    artifact: ArtifactResponse
    direction: DirectionResponse


class StartSessionRequest(BaseModel):
    brand_name: NonEmptyString = Field(max_length=80)
    description: NonEmptyString = Field(min_length=5, max_length=280)
    goal: NonEmptyString | None = Field(default=None, min_length=10, max_length=500)
    reference: NonEmptyString | None = Field(default=None, max_length=240)


class RejectDirectionRequest(BaseModel):
    session_id: NonEmptyString
    rejections: list[RejectionModel] = Field(min_length=2, max_length=2)


class ApproveDirectionRequest(BaseModel):
    session_id: NonEmptyString


class ExecuteRequest(BaseModel):
    session_id: NonEmptyString


def get_hermes() -> Hermes:
    return hermes


def resolve_transitional_user_id() -> str:
    supplied = os.getenv("CREATIVE_DEMO_USER_ID")
    if supplied:
        try:
            return str(UUID(supplied))
        except ValueError as exc:
            raise HTTPException(
                status_code=503,
                detail="CREATIVE_DEMO_USER_ID must be a valid UUID.",
            ) from exc
    if os.getenv("SUPABASE_URL"):
        raise HTTPException(
            status_code=503,
            detail=(
                "CREATIVE_DEMO_USER_ID is required when SUPABASE_URL is configured."
            ),
        )
    return TRANSITIONAL_MEMORY_USER_ID


HermesDependency = Annotated[Hermes, Depends(get_hermes)]


@router.post(
    "/start",
    status_code=status.HTTP_201_CREATED,
    response_model=CreativeSessionResponse,
)
def start_session(
    request: StartSessionRequest, coordinator: HermesDependency
) -> dict:
    user_id = resolve_transitional_user_id()
    return coordinator.start_session(
        user_id=user_id,
        brand_name=request.brand_name,
        description=request.description,
        goal=request.goal,
        reference=request.reference,
    )


@router.post("/reject", response_model=CreativeSessionResponse)
def reject_direction(
    request: RejectDirectionRequest, coordinator: HermesDependency
) -> dict:
    try:
        user_id = resolve_transitional_user_id()
        rejections = [Rejection(**item.model_dump()) for item in request.rejections]
        return coordinator.handle_rejection(user_id, request.session_id, rejections)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except (InvalidSessionStateError, DirectionNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/approve", response_model=CreativeSessionResponse)
def approve_direction(
    request: ApproveDirectionRequest, coordinator: HermesDependency
) -> dict:
    try:
        user_id = resolve_transitional_user_id()
        return coordinator.approve(user_id, request.session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except (InvalidSessionStateError, DirectionNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/execute", response_model=ExecuteResponse)
def execute(request: ExecuteRequest, coordinator: HermesDependency) -> dict:
    try:
        user_id = resolve_transitional_user_id()
        return coordinator.execute(user_id, request.session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except InvalidSessionStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
