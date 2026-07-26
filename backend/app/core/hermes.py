"""Owner-scoped creative lifecycle coordinated through injected dependencies."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timezone
from threading import RLock
from typing import Protocol
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
from app.persistence.session_store import SessionStore


class RoutingReadiness(Protocol):
    def require_configured(self, user_id: str) -> None: ...


class SessionNotFoundError(KeyError):
    """Raised when a creative session does not exist."""


class InvalidSessionStateError(ValueError):
    """Raised when an action is invalid for the current session state."""


class DirectionNotFoundError(ValueError):
    """Raised when a selected creative direction does not exist."""


class Hermes:
    """Thread-safe coordinator.

    One lock intentionally covers each generative transition within this Hermes
    instance so two in-process requests cannot call a provider from the same
    prior state. Persistence does not provide a cross-worker compare-and-swap.
    """

    def __init__(
        self,
        *,
        store: SessionStore,
        readiness: RoutingReadiness,
        dna_agent: DnaAgent,
        direction_agent: DirectionAgent,
        critic_agent: CriticAgent,
        content_agent: ContentAgent,
    ) -> None:
        self._lock = RLock()
        self._sessions: dict[tuple[str, str], CreativeSession] = {}
        self._store = store
        self._readiness = readiness
        self._dna_agent = dna_agent
        self._direction_agent = direction_agent
        self._critic_agent = critic_agent
        self._content_agent = content_agent

    @property
    def cached_session_count(self) -> int:
        with self._lock:
            return len(self._sessions)

    def start_session(
        self,
        user_id: str,
        brand_name: str,
        description: str,
        goal: str | None = None,
        reference: str | None = None,
    ) -> dict:
        self._readiness.require_configured(user_id)
        dna = self._dna_agent.hypothesize(
            user_id=user_id,
            brand_name=brand_name,
            description=description,
            goal=goal,
            reference=reference,
        )
        directions = self._direction_agent.generate(
            user_id=user_id,
            brand_name=brand_name,
            description=description,
            goal=goal,
            dna=dna,
        )
        session = CreativeSession(
            session_id=str(uuid4()),
            user_id=user_id,
            brand_name=brand_name,
            description=description,
            goal=goal,
            reference=reference,
            dna=dna,
            directions=directions,
        )

        with self._lock:
            self._store.create(user_id, session.session_id, self._serialize(session))
            self._sessions[(user_id, session.session_id)] = session

        return self._serialize(session)

    def handle_rejection(
        self,
        user_id: str,
        session_id: str,
        rejections: list[Rejection],
    ) -> dict:
        with self._lock:
            current = self._get_active_session(user_id, session_id, cache=False)

            if len(rejections) != 2:
                raise InvalidSessionStateError("Exactly two directions must be rejected.")

            rejected_ids = {rejection.direction_id for rejection in rejections}
            if len(rejected_ids) != 2:
                raise InvalidSessionStateError("Rejected directions must be distinct.")

            direction_ids = {direction.id for direction in current.directions}
            unknown_ids = rejected_ids - direction_ids
            if unknown_ids:
                raise DirectionNotFoundError(
                    f"Creative direction {min(unknown_ids)} does not exist."
                )

            self._readiness.require_configured(user_id)

            candidate = deepcopy(current)
            candidate.rejections = list(rejections)

            # Build constraints and refined direction.
            candidate.constraints = self._critic_agent.extract_constraints_structured(
                user_id=user_id,
                brand_name=candidate.brand_name,
                description=candidate.description,
                goal=candidate.goal,
                dna=candidate.dna,
                rejections=candidate.rejections,
            )

            base = self._pick_base_direction(candidate)
            candidate.refined_direction = self._direction_agent.refine(
                user_id=user_id,
                session=candidate,
                base_direction=base,
                constraints=candidate.constraints,
            )
            candidate.status = "refined_ready"
            candidate.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._persist_candidate(user_id, session_id, candidate)
            return self._serialize(candidate)

    def approve(self, user_id: str, session_id: str) -> dict:
        with self._lock:
            current = self._get_session(user_id, session_id, cache=False)
            if current.status in {"approved", "executed"}:
                return self._serialize(current)
            if current.status != "refined_ready":
                raise InvalidSessionStateError(
                    f"Session is {current.status} and cannot be approved."
                )
            if current.refined_direction is None:
                raise InvalidSessionStateError("No direction to approve.")
            candidate = deepcopy(current)
            candidate.status = "approved"
            candidate.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._persist_candidate(user_id, session_id, candidate)
            return self._serialize(candidate)

    def execute(self, user_id: str, session_id: str) -> dict:
        with self._lock:
            current = self._get_session(user_id, session_id, cache=False)
            if current.status not in {"approved", "executed"}:
                raise InvalidSessionStateError(
                    "Approve a direction before generating the final artifact."
                )
            if current.status == "executed":
                return self._execution_response(current)

            self._readiness.require_configured(user_id)

            candidate = deepcopy(current)
            candidate.artifact = self._content_agent.generate(user_id, candidate)
            candidate.status = "executed"
            candidate.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._persist_candidate(user_id, session_id, candidate)
            return self._execution_response(candidate)

    @staticmethod
    def _execution_response(session: CreativeSession) -> dict:
        return {
            "session_id": session.session_id,
            "status": session.status,
            "artifact": asdict(session.artifact),
            "direction": asdict(session.refined_direction) if session.refined_direction else None,
        }

    def get_session(self, user_id: str, session_id: str) -> dict:
        with self._lock:
            session = self._get_session(user_id, session_id)
            return self._serialize(session)

    def list_sessions(self, user_id: str) -> list[dict]:
        with self._lock:
            result: list[dict] = []
            for data in self._store.list(user_id):
                session_id = data.get("session_id")
                if data.get("user_id") != user_id or not isinstance(session_id, str):
                    continue
                result.append(self._serialize(self._deserialize(data)))
            return result

    def _persist_candidate(
        self, user_id: str, session_id: str, session: CreativeSession
    ) -> None:
        self._require_session_key(user_id, session_id, session)
        self._store.save(user_id, session_id, self._serialize(session))
        self._sessions[(user_id, session_id)] = session

    def _get_active_session(
        self, user_id: str, session_id: str, *, cache: bool = True
    ) -> CreativeSession:
        session = self._get_session(user_id, session_id, cache=cache)
        if session.status != "active":
            raise InvalidSessionStateError(
                f"Session is already {session.status} and cannot be changed."
            )
        return session

    def _get_session(
        self, user_id: str, session_id: str, *, cache: bool = True
    ) -> CreativeSession:
        # Prefer in-memory cache, else load from store.
        cache_key = (user_id, session_id)
        if cache:
            session = self._sessions.get(cache_key)
            if session is not None:
                self._require_session_key(user_id, session_id, session)
                return session
        data = self._store.get(user_id, session_id)
        if data is None:
            raise SessionNotFoundError(session_id)
        if data.get("user_id") != user_id or data.get("session_id") != session_id:
            raise SessionNotFoundError(session_id)
        session = self._deserialize(data)
        if cache:
            self._sessions[cache_key] = session
        return session

    @staticmethod
    def _require_session_key(
        user_id: str, session_id: str, session: CreativeSession
    ) -> None:
        if session.user_id != user_id or session.session_id != session_id:
            raise SessionNotFoundError(session_id)

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
            user_id=data["user_id"],
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
