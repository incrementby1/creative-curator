"""Deterministic orchestration for the first creative-direction workflow.

This module deliberately has no model-provider dependency yet. It gives the API a
stable contract that can later be backed by an LLM without changing the client.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from threading import RLock
from uuid import uuid4


class SessionNotFoundError(KeyError):
    """Raised when a creative session does not exist."""


class InvalidSessionStateError(ValueError):
    """Raised when an action is invalid for the current session state."""


class DirectionNotFoundError(ValueError):
    """Raised when a selected creative direction does not exist."""


@dataclass(frozen=True)
class CreativeDirection:
    id: int
    title: str
    concept: str
    why_it_works: str
    palette: tuple[str, ...]
    channels: tuple[str, ...]


@dataclass
class CreativeSession:
    session_id: str
    brand_id: str
    goal: str
    directions: list[CreativeDirection]
    round: int = 1
    status: str = "active"
    feedback: list[str] = field(default_factory=list)


class Hermes:
    """Thread-safe, in-memory creative session coordinator."""

    def __init__(self) -> None:
        self._sessions: dict[str, CreativeSession] = {}
        self._lock = RLock()

    def start_session(self, brand_id: str, goal: str) -> dict:
        session = CreativeSession(
            session_id=str(uuid4()),
            brand_id=brand_id,
            goal=goal,
            directions=self._build_directions(brand_id, goal, round_number=1),
        )
        with self._lock:
            self._sessions[session.session_id] = session
        return asdict(session)

    def handle_rejection(self, session_id: str, reasons: list[str]) -> dict:
        with self._lock:
            session = self._get_active_session(session_id)
            session.feedback.extend(reasons)
            session.round += 1
            feedback = ", ".join(reasons)
            session.directions = self._build_directions(
                session.brand_id,
                session.goal,
                round_number=session.round,
                feedback=feedback,
            )
            return asdict(session)

    def deploy(self, session_id: str, choice_id: int) -> dict:
        with self._lock:
            session = self._get_active_session(session_id)
            direction = next(
                (item for item in session.directions if item.id == choice_id), None
            )
            if direction is None:
                raise DirectionNotFoundError(
                    f"Direction {choice_id} is not part of this session."
                )
            session.status = "approved"
            return {
                "session_id": session.session_id,
                "status": session.status,
                "direction": asdict(direction),
                "next_steps": [
                    "Turn the concept into a channel-ready creative brief.",
                    "Produce the first asset set and copy variants.",
                    "Review performance signals after launch.",
                ],
            }

    def _get_active_session(self, session_id: str) -> CreativeSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.status != "active":
            raise InvalidSessionStateError(
                f"Session is already {session.status} and cannot be changed."
            )
        return session

    @staticmethod
    def _build_directions(
        brand_id: str,
        goal: str,
        round_number: int,
        feedback: str | None = None,
    ) -> list[CreativeDirection]:
        context = f" for {brand_id}" if brand_id else ""
        revision = (
            f" This revision responds to: {feedback}." if feedback else ""
        )
        concepts = [
            (
                "The Signal",
                f"Lead with one unmistakable promise{context}, then make every "
                f"visual element reinforce the goal: {goal}.{revision}",
                "A focused message is quick to understand and easy to adapt across formats.",
                ("#171717", "#F5F1E8", "#FF5C35"),
                ("Social", "Landing page", "Paid media"),
            ),
            (
                "Proof in Motion",
                f"Build a before-and-after narrative around {goal}, using specific "
                f"moments of progress as the visual system.{revision}",
                "Visible transformation turns an abstract promise into credible evidence.",
                ("#102A43", "#D9EAF4", "#2EC4B6"),
                ("Short video", "Email", "Case study"),
            ),
            (
                "Open Invitation",
                f"Frame {goal} as a shared challenge and invite the audience to "
                f"participate, respond, or remix the idea.{revision}",
                "Participation creates relevance and gives the campaign room to grow organically.",
                ("#35155D", "#FFF3DA", "#F7B801"),
                ("Community", "Organic social", "Events"),
            ),
        ]
        return [
            CreativeDirection(
                id=index,
                title=f"{title} · R{round_number}",
                concept=concept,
                why_it_works=why,
                palette=palette,
                channels=channels,
            )
            for index, (title, concept, why, palette, channels) in enumerate(concepts, 1)
        ]


hermes = Hermes()
