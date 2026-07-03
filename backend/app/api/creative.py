from fastapi import APIRouter
from app.core.hermes import hermes

router = APIRouter()

@router.post("/start")
def start_session(brand_id: str, goal: str):
    return hermes.start_session(brand_id, goal)

@router.post("/reject")
def reject_direction(session_id: str, reasons: list[str]):
    return hermes.handle_rejection(session_id, reasons)

@router.post("/approve")
def approve_direction(session_id: str, choice_id: int):
    return hermes.deploy(session_id, choice_id)