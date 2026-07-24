from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints

from app.auth.identity import UserIdentity, get_current_user
from app.composition import get_application_composition
from app.core.hermes import (
    DirectionNotFoundError,
    Hermes,
    InvalidSessionStateError,
    SessionNotFoundError,
)
from app.core.types import Rejection
from app.llm.types import AiConfigurationRequired, AllProvidersFailed

router = APIRouter(tags=["creative"])

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
    return get_application_composition().hermes


HermesDependency = Annotated[Hermes, Depends(get_hermes)]
IdentityDependency = Annotated[UserIdentity, Depends(get_current_user)]


@router.post(
    "/start",
    status_code=status.HTTP_201_CREATED,
    response_model=CreativeSessionResponse,
)
def start_session(
    request: StartSessionRequest,
    coordinator: HermesDependency,
    identity: IdentityDependency,
) -> dict:
    try:
        return coordinator.start_session(
            user_id=identity.user_id,
            brand_name=request.brand_name,
            description=request.description,
            goal=request.goal,
            reference=request.reference,
        )
    except (AiConfigurationRequired, AllProvidersFailed) as exc:
        _raise_ai_error(exc)


@router.post("/reject", response_model=CreativeSessionResponse)
def reject_direction(
    request: RejectDirectionRequest,
    coordinator: HermesDependency,
    identity: IdentityDependency,
) -> dict:
    try:
        rejections = [Rejection(**item.model_dump()) for item in request.rejections]
        return coordinator.handle_rejection(
            identity.user_id, request.session_id, rejections
        )
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except (InvalidSessionStateError, DirectionNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (AiConfigurationRequired, AllProvidersFailed) as exc:
        _raise_ai_error(exc)


@router.post("/approve", response_model=CreativeSessionResponse)
def approve_direction(
    request: ApproveDirectionRequest,
    coordinator: HermesDependency,
    identity: IdentityDependency,
) -> dict:
    try:
        return coordinator.approve(identity.user_id, request.session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except (InvalidSessionStateError, DirectionNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/execute", response_model=ExecuteResponse)
def execute(
    request: ExecuteRequest,
    coordinator: HermesDependency,
    identity: IdentityDependency,
) -> dict:
    try:
        return coordinator.execute(identity.user_id, request.session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except InvalidSessionStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (AiConfigurationRequired, AllProvidersFailed) as exc:
        _raise_ai_error(exc)


def _raise_ai_error(exc: AiConfigurationRequired | AllProvidersFailed) -> None:
    if isinstance(exc, AiConfigurationRequired):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "ai_configuration_required"},
        ) from None
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "code": "all_providers_failed",
            "attempts": [
                {
                    "provider_slug": attempt.provider_slug,
                    "category": attempt.category,
                }
                for attempt in exc.attempts
            ],
        },
    ) from None
