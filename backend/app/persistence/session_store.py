from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol


class SessionStore(Protocol):
    def create(self, session_id: str, state: dict) -> None: ...

    def get(self, session_id: str) -> dict | None: ...

    def save(self, session_id: str, state: dict) -> None: ...


@dataclass
class InMemorySessionStore:
    _sessions: dict[str, dict]

    def __init__(self) -> None:
        self._sessions = {}

    def create(self, session_id: str, state: dict) -> None:
        self._sessions[session_id] = state

    def get(self, session_id: str) -> dict | None:
        return self._sessions.get(session_id)

    def save(self, session_id: str, state: dict) -> None:
        self._sessions[session_id] = state


class SupabaseSessionStore:
    def __init__(self, url: str, key: str) -> None:
        try:
            from supabase import create_client  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "Supabase configured but 'supabase' package is not installed."
            ) from exc

        self._client = create_client(url, key)
        self._table = "creative_sessions"

    def create(self, session_id: str, state: dict) -> None:
        payload = {
            "id": session_id,
            "brand_name": state.get("brand_name") or "",
            "description": state.get("description") or "",
            "goal": state.get("goal"),
            "status": state.get("status") or "active",
            "state": state,
        }
        self._client.table(self._table).insert(payload).execute()

    def get(self, session_id: str) -> dict | None:
        res = (
            self._client.table(self._table)
            .select("state")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        data = getattr(res, "data", None) or []
        if not data:
            return None
        return data[0].get("state")

    def save(self, session_id: str, state: dict) -> None:
        payload = {
            "brand_name": state.get("brand_name") or "",
            "description": state.get("description") or "",
            "goal": state.get("goal"),
            "status": state.get("status") or "active",
            "state": state,
        }
        self._client.table(self._table).update(payload).eq("id", session_id).execute()


_DEFAULT_STORE: SessionStore | None = None


def get_default_session_store() -> SessionStore:
    global _DEFAULT_STORE
    if _DEFAULT_STORE is not None:
        return _DEFAULT_STORE

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

    if url and key:
        try:
            _DEFAULT_STORE = SupabaseSessionStore(url=url, key=key)
            return _DEFAULT_STORE
        except Exception:
            # Fall back quietly for demo reliability.
            pass

    _DEFAULT_STORE = InMemorySessionStore()
    return _DEFAULT_STORE
