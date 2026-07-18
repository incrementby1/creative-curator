from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints

from app.core.hermes import (
    DirectionNotFoundError,
    InvalidSessionStateError,
    SessionNotFoundError,
    hermes,
)
from app.core.types import Rejection

router = APIRouter(tags=["creative"])
NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class StartSessionRequest(BaseModel):
    brand_name: NonEmptyString = Field(max_length=80)
    description: NonEmptyString = Field(min_length=5, max_length=280)
    goal: NonEmptyString | None = Field(default=None, min_length=10, max_length=500)
    reference: NonEmptyString | None = Field(default=None, max_length=240)


RejectionReason = Literal[
    "too_generic",
    "too_loud",
    "not_our_audience",
    "not_authentic",
    "other",
]


class RejectionModel(BaseModel):
    direction_id: int = Field(ge=1)
    reason: RejectionReason
    note: NonEmptyString | None = Field(default=None, max_length=240)


class RejectDirectionRequest(BaseModel):
    session_id: NonEmptyString
    # Back-compat: old client sent free-text reasons.
    reasons: list[NonEmptyString] | None = Field(default=None, min_length=1, max_length=8)
    # New MVP: structured rejections.
    rejections: list[RejectionModel] | None = Field(default=None, min_length=1, max_length=3)


class ApproveDirectionRequest(BaseModel):
    session_id: NonEmptyString


class ExecuteRequest(BaseModel):
    session_id: NonEmptyString


@router.post("/start", status_code=status.HTTP_201_CREATED)
def start_session(request: StartSessionRequest) -> dict:
    return hermes.start_session(
        brand_name=request.brand_name,
        description=request.description,
        goal=request.goal,
        reference=request.reference,
    )


@router.post("/reject")
def reject_direction(request: RejectDirectionRequest) -> dict:
    try:
        parsed_rejections = None
        if request.rejections is not None:
            parsed_rejections = [
                Rejection(
                    direction_id=item.direction_id,
                    reason=item.reason,
                    note=item.note,
                )
                for item in request.rejections
            ]
        return hermes.handle_rejection(
            request.session_id,
            reasons=request.reasons,
            rejections=parsed_rejections,
        )
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except InvalidSessionStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/approve")
def approve_direction(request: ApproveDirectionRequest) -> dict:
    try:
        return hermes.approve(request.session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except (InvalidSessionStateError, DirectionNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/execute")
def execute(request: ExecuteRequest) -> dict:
    try:
        return hermes.execute(request.session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except InvalidSessionStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
