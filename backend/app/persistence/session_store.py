from __future__ import annotations

import os
from copy import deepcopy
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse


def require_local_supabase_url(url: str) -> None:
    if urlparse(url).hostname not in {"localhost", "127.0.0.1"}:
        raise RuntimeError(
            "Local Supabase tests may only target localhost or 127.0.0.1."
        )


class SessionStore(Protocol):
    def create(self, user_id: str, session_id: str, state: dict) -> None: ...

    def get(self, user_id: str, session_id: str) -> dict | None: ...

    def list(self, user_id: str) -> list[dict]: ...

    def save(self, user_id: str, session_id: str, state: dict) -> None: ...


@dataclass
class InMemorySessionStore:
    _sessions: dict[tuple[str, str], dict]

    def __init__(self) -> None:
        self._sessions = {}

    def create(self, user_id: str, session_id: str, state: dict) -> None:
        self._sessions[(user_id, session_id)] = deepcopy(state)

    def get(self, user_id: str, session_id: str) -> dict | None:
        state = self._sessions.get((user_id, session_id))
        return deepcopy(state) if state is not None else None

    def list(self, user_id: str) -> list[dict]:
        sessions = [
            deepcopy(state)
            for (owner_id, _session_id), state in self._sessions.items()
            if owner_id == user_id
        ]
        return sorted(
            sessions,
            key=lambda state: (
                state.get("updated_at") or "",
                state.get("session_id") or "",
            ),
            reverse=True,
        )

    def save(self, user_id: str, session_id: str, state: dict) -> None:
        self._sessions[(user_id, session_id)] = deepcopy(state)


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

    def create(self, user_id: str, session_id: str, state: dict) -> None:
        payload = {
            "id": session_id,
            "user_id": user_id,
            "brand_name": state.get("brand_name") or "",
            "description": state.get("description") or "",
            "goal": state.get("goal"),
            "status": state.get("status") or "active",
            "state": state,
        }
        self._client.table(self._table).insert(payload).execute()

    def get(self, user_id: str, session_id: str) -> dict | None:
        res = (
            self._client.table(self._table)
            .select("state")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        data = getattr(res, "data", None) or []
        if not data:
            return None
        return data[0].get("state")

    def list(self, user_id: str) -> list[dict]:
        res = (
            self._client.table(self._table)
            .select("state")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .order("id", desc=True)
            .execute()
        )
        return [
            deepcopy(row["state"])
            for row in (getattr(res, "data", None) or [])
            if isinstance(row.get("state"), dict)
        ]

    def save(self, user_id: str, session_id: str, state: dict) -> None:
        payload = {
            "brand_name": state.get("brand_name") or "",
            "description": state.get("description") or "",
            "goal": state.get("goal"),
            "status": state.get("status") or "active",
            "state": state,
        }
        (
            self._client.table(self._table)
            .update(payload)
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )


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
