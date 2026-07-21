"""Hermes: session-based creative direction workflow.

Implements the hackathon MVP loop:
  Intake -> Brand DNA hypothesis -> 3 directions -> reject 2 -> refined direction -> content artifact

Persistence:
  - Defaults to in-memory.
  - If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are set,
    sessions are stored in Supabase Postgres via the `creative_sessions` table.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from threading import RLock
from uuid import uuid4

from app.agents.content_agent import ContentAgent
from app.agents.critic_agent import CriticAgent
from app.agents.dna_agent import DnaAgent
from app.agents.direction_agent import DirectionAgent
from app.core.types import (
    BrandDNA,
    ContentArtifact,
    CreativeDirection,
    CreativeSession,
    Rejection,
    ToneSlider,
)
from app.persistence.session_store import SessionStore, get_default_session_store


class SessionNotFoundError(KeyError):
    """Raised when a creative session does not exist."""


class InvalidSessionStateError(ValueError):
    """Raised when an action is invalid for the current session state."""


class DirectionNotFoundError(ValueError):
    """Raised when a selected creative direction does not exist."""


class Hermes:
    """Thread-safe creative session coordinator."""

    def __init__(
        self,
        store: SessionStore | None = None,
        dna_agent: DnaAgent | None = None,
        direction_agent: DirectionAgent | None = None,
        critic_agent: CriticAgent | None = None,
        content_agent: ContentAgent | None = None,
    ) -> None:
        self._lock = RLock()
        self._sessions: dict[str, CreativeSession] = {}
        self._store = store or get_default_session_store()
        self._dna_agent = dna_agent or DnaAgent()
        self._direction_agent = direction_agent or DirectionAgent()
        self._critic_agent = critic_agent or CriticAgent()
        self._content_agent = content_agent or ContentAgent()

    def start_session(
        self,
        brand_name: str,
        description: str,
        goal: str | None = None,
        reference: str | None = None,
    ) -> dict:
        dna = self._dna_agent.hypothesize(
            brand_name=brand_name,
            description=description,
            goal=goal,
            reference=reference,
        )
        directions = self._direction_agent.generate(
            brand_name=brand_name,
            description=description,
            goal=goal,
            dna=dna,
        )
        session = CreativeSession(
            session_id=str(uuid4()),
            brand_name=brand_name,
            description=description,
            goal=goal,
            reference=reference,
            dna=dna,
            directions=directions,
        )

        with self._lock:
            self._sessions[session.session_id] = session
            self._store.create(session.session_id, self._serialize(session))

        return self._serialize(session)

    def handle_rejection(
        self,
        session_id: str,
        rejections: list[Rejection],
    ) -> dict:
        with self._lock:
            session = self._get_active_session(session_id)

            if len(rejections) != 2:
                raise InvalidSessionStateError("Exactly two directions must be rejected.")

            rejected_ids = {rejection.direction_id for rejection in rejections}
            if len(rejected_ids) != 2:
                raise InvalidSessionStateError("Rejected directions must be distinct.")

            direction_ids = {direction.id for direction in session.directions}
            unknown_ids = rejected_ids - direction_ids
            if unknown_ids:
                raise DirectionNotFoundError(
                    f"Creative direction {min(unknown_ids)} does not exist."
                )

            session.rejections = list(rejections)

            # Build constraints and refined direction.
            session.constraints = self._critic_agent.extract_constraints_structured(
                brand_name=session.brand_name,
                description=session.description,
                goal=session.goal,
                dna=session.dna,
                rejections=session.rejections,
            )

            base = self._pick_base_direction(session)
            session.refined_direction = self._direction_agent.refine(
                session=session,
                base_direction=base,
                constraints=session.constraints,
            )
            session.status = "refined_ready"
            session.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._persist(session)
            return self._serialize(session)

    def approve(self, session_id: str) -> dict:
        with self._lock:
            session = self._get_session(session_id)
            if session.status != "refined_ready":
                raise InvalidSessionStateError(
                    f"Session is {session.status} and cannot be approved."
                )
            if session.refined_direction is None:
                raise InvalidSessionStateError("No direction to approve.")
            session.status = "approved"
            session.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._persist(session)
            return self._serialize(session)

    def execute(self, session_id: str) -> dict:
        with self._lock:
            session = self._get_session(session_id)
            if session.status not in {"approved", "executed"}:
                raise InvalidSessionStateError(
                    "Approve a direction before generating the final artifact."
                )
            if session.artifact is None:
                session.artifact = self._content_agent.generate(session)
                session.status = "executed"
                session.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                self._persist(session)
            return {
                "session_id": session.session_id,
                "status": session.status,
                "artifact": asdict(session.artifact),
                "direction": asdict(session.refined_direction) if session.refined_direction else None,
            }

    def get_session(self, session_id: str) -> dict:
        with self._lock:
            session = self._get_session(session_id)
            return self._serialize(session)

    def _persist(self, session: CreativeSession) -> None:
        self._store.save(session.session_id, self._serialize(session))

    def _get_active_session(self, session_id: str) -> CreativeSession:
        session = self._get_session(session_id)
        if session.status != "active":
            raise InvalidSessionStateError(
                f"Session is already {session.status} and cannot be changed."
            )
        return session

    def _get_session(self, session_id: str) -> CreativeSession:
        # Prefer in-memory cache, else load from store.
        session = self._sessions.get(session_id)
        if session is not None:
            return session
        data = self._store.get(session_id)
        if data is None:
            raise SessionNotFoundError(session_id)
        session = self._deserialize(data)
        self._sessions[session_id] = session
        return session

    @staticmethod
    def _serialize(session: CreativeSession) -> dict:
        payload = asdict(session)
        # Ensure tuples become lists for JSON
        return payload

    @staticmethod
    def _deserialize(data: dict) -> CreativeSession:
        dna_dict = data.get("dna") or {}
        sliders = dna_dict.get("tone_sliders") or []
        dna = BrandDNA(
            beliefs=tuple(dna_dict.get("beliefs") or ("", "", "")),
            tone_sliders=(
                ToneSlider(**sliders[0]) if len(sliders) > 0 else ToneSlider("Energy", "Calm", "Bold", 50),
                ToneSlider(**sliders[1]) if len(sliders) > 1 else ToneSlider("Voice", "Formal", "Casual", 50),
            ),
        )

        def dir_from(d: dict) -> CreativeDirection:
            return CreativeDirection(
                id=int(d.get("id")),
                name=d.get("name") or d.get("title") or "",
                tone=d.get("tone") or "",
                visual_style=d.get("visual_style") or "",
                creative_intent=d.get("creative_intent") or "",
                palette=tuple(d.get("palette") or []),
                channels=tuple(d.get("channels") or []),
                why_it_works=d.get("why_it_works") or "",
            )

        directions = [dir_from(d) for d in (data.get("directions") or [])]
        refined = data.get("refined_direction")
        refined_direction = dir_from(refined) if isinstance(refined, dict) else None

        rejections = []
        for r in data.get("rejections") or []:
            try:
                rejections.append(Rejection(**r))
            except TypeError:
                continue

        artifact = None
        if isinstance(data.get("artifact"), dict):
            a = data["artifact"]
            artifact = ContentArtifact(
                caption=a.get("caption") or "",
                layout_mock_svg=a.get("layout_mock_svg") or "",
                rationale=tuple(a.get("rationale") or ("", "", "")),
            )

        return CreativeSession(
            session_id=data["session_id"],
            brand_name=data.get("brand_name") or data.get("brand_id") or "",
            description=data.get("description") or "",
            goal=data.get("goal"),
            reference=data.get("reference"),
            dna=dna,
            directions=directions,
            round=int(data.get("round") or 1),
            status=data.get("status") or "active",
            rejections=rejections,
            constraints=list(data.get("constraints") or []),
            refined_direction=refined_direction,
            artifact=artifact,
            updated_at=data.get("updated_at")
            or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )

    @staticmethod
    def _pick_base_direction(session: CreativeSession) -> CreativeDirection:
        rejected_ids = {r.direction_id for r in session.rejections}
        for d in session.directions:
            if d.id not in rejected_ids:
                return d
        # Fallback
        return session.directions[0]


hermes = Hermes()
