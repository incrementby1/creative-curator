from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints

from app.core.hermes import (
    DirectionNotFoundError,
    InvalidSessionStateError,
    SessionNotFoundError,
    hermes,
)

router = APIRouter(tags=["creative"])
NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class StartSessionRequest(BaseModel):
    brand_id: NonEmptyString = Field(max_length=80)
    goal: NonEmptyString = Field(min_length=10, max_length=500)


class RejectDirectionRequest(BaseModel):
    session_id: NonEmptyString
    reasons: list[NonEmptyString] = Field(min_length=1, max_length=8)


class ApproveDirectionRequest(BaseModel):
    session_id: NonEmptyString
    choice_id: int = Field(ge=1)


@router.post("/start", status_code=status.HTTP_201_CREATED)
def start_session(request: StartSessionRequest) -> dict:
    return hermes.start_session(request.brand_id, request.goal)


@router.post("/reject")
def reject_direction(request: RejectDirectionRequest) -> dict:
    try:
        return hermes.handle_rejection(request.session_id, request.reasons)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except InvalidSessionStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/approve")
def approve_direction(request: ApproveDirectionRequest) -> dict:
    try:
        return hermes.deploy(request.session_id, request.choice_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Creative session not found.") from exc
    except (InvalidSessionStateError, DirectionNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
