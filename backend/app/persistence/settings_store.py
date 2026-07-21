from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from typing import Any, Protocol

from app.security.credential_cipher import EncryptedCredential
from app.settings.types import (
    ProviderCredentialRecord,
    RouteTarget,
    RoutingSettings,
    SettingsStoreError,
    SettingsVersionConflict,
)


class SettingsStore(Protocol):
    def list_credentials(self, user_id: str) -> list[ProviderCredentialRecord]: ...

    def get_credential(
        self, user_id: str, provider_slug: str
    ) -> ProviderCredentialRecord | None: ...

    def upsert_credential(
        self, user_id: str, record: ProviderCredentialRecord
    ) -> ProviderCredentialRecord: ...

    def delete_credential(self, user_id: str, provider_slug: str) -> bool: ...

    def get_routing(self, user_id: str) -> RoutingSettings: ...

    def save_routing(
        self, user_id: str, settings: RoutingSettings
    ) -> RoutingSettings: ...


class InMemorySettingsStore:
    def __init__(self) -> None:
        self._credentials: dict[tuple[str, str], ProviderCredentialRecord] = {}
        self._routing: dict[str, RoutingSettings] = {}
        self._lock = RLock()

    def list_credentials(self, user_id: str) -> list[ProviderCredentialRecord]:
        with self._lock:
            records = [
                record
                for (owner, _provider), record in self._credentials.items()
                if owner == user_id
            ]
            return deepcopy(records)

    def get_credential(
        self, user_id: str, provider_slug: str
    ) -> ProviderCredentialRecord | None:
        with self._lock:
            record = self._credentials.get((user_id, provider_slug))
            return deepcopy(record) if record is not None else None

    def upsert_credential(
        self, user_id: str, record: ProviderCredentialRecord
    ) -> ProviderCredentialRecord:
        with self._lock:
            stored = deepcopy(record)
            self._credentials[(user_id, record.provider_slug)] = stored
            return deepcopy(stored)

    def delete_credential(self, user_id: str, provider_slug: str) -> bool:
        with self._lock:
            return self._credentials.pop((user_id, provider_slug), None) is not None

    def get_routing(self, user_id: str) -> RoutingSettings:
        with self._lock:
            return deepcopy(self._routing.get(user_id, RoutingSettings()))

    def save_routing(
        self, user_id: str, settings: RoutingSettings
    ) -> RoutingSettings:
        with self._lock:
            current = self._routing.get(user_id, RoutingSettings())
            if settings.version != current.version:
                raise SettingsVersionConflict("Routing settings version conflict.")
            saved = RoutingSettings(
                primary_provider_slug=settings.primary_provider_slug,
                primary_model=settings.primary_model,
                fallbacks=deepcopy(settings.fallbacks),
                version=settings.version + 1,
            )
            self._routing[user_id] = saved
            return deepcopy(saved)


class SupabaseSettingsStore:
    def __init__(self, client: Any) -> None:
        self._client = client

    def list_credentials(self, user_id: str) -> list[ProviderCredentialRecord]:
        try:
            response = (
                self._client.table("provider_credentials")
                .select(_CREDENTIAL_COLUMNS)
                .eq("user_id", user_id)
                .execute()
            )
            return [_credential_from_row(row) for row in _data(response)]
        except SettingsStoreError:
            raise
        except Exception:
            raise _store_error() from None

    def get_credential(
        self, user_id: str, provider_slug: str
    ) -> ProviderCredentialRecord | None:
        try:
            response = (
                self._client.table("provider_credentials")
                .select(_CREDENTIAL_COLUMNS)
                .eq("user_id", user_id)
                .eq("provider_slug", provider_slug)
                .limit(1)
                .execute()
            )
            rows = _data(response)
            return _credential_from_row(rows[0]) if rows else None
        except SettingsStoreError:
            raise
        except Exception:
            raise _store_error() from None

    def upsert_credential(
        self, user_id: str, record: ProviderCredentialRecord
    ) -> ProviderCredentialRecord:
        payload = _credential_payload(user_id, record)
        try:
            response = (
                self._client.table("provider_credentials")
                .upsert(payload, on_conflict="user_id,provider_slug")
                .execute()
            )
            rows = _data(response)
            return _credential_from_row(rows[0]) if rows else deepcopy(record)
        except SettingsStoreError:
            raise
        except Exception:
            raise _store_error() from None

    def delete_credential(self, user_id: str, provider_slug: str) -> bool:
        try:
            response = (
                self._client.table("provider_credentials")
                .delete()
                .eq("user_id", user_id)
                .eq("provider_slug", provider_slug)
                .execute()
            )
            return bool(_data(response))
        except SettingsStoreError:
            raise
        except Exception:
            raise _store_error() from None

    def get_routing(self, user_id: str) -> RoutingSettings:
        try:
            row = self._get_routing_row(user_id)
            return _routing_from_row(row) if row is not None else RoutingSettings()
        except SettingsStoreError:
            raise
        except Exception:
            raise _store_error() from None

    def save_routing(
        self, user_id: str, settings: RoutingSettings
    ) -> RoutingSettings:
        try:
            current = self._get_routing_row(user_id)
        except SettingsStoreError:
            raise
        except Exception:
            raise _store_error() from None

        if current is None:
            if settings.version != 1:
                raise SettingsVersionConflict("Routing settings version conflict.")
            payload = _routing_payload(user_id, settings, 2)
            try:
                response = (
                    self._client.table("user_ai_settings").insert(payload).execute()
                )
            except Exception as exc:
                if _is_unique_conflict(exc):
                    raise SettingsVersionConflict(
                        "Routing settings version conflict."
                    ) from None
                raise _store_error() from None
        else:
            current_version = current.get("version")
            if settings.version != current_version:
                raise SettingsVersionConflict("Routing settings version conflict.")
            payload = _routing_payload(user_id, settings, settings.version + 1)
            update_payload = dict(payload)
            update_payload.pop("user_id")
            try:
                response = (
                    self._client.table("user_ai_settings")
                    .update(update_payload)
                    .eq("user_id", user_id)
                    .eq("version", settings.version)
                    .execute()
                )
            except Exception:
                raise _store_error() from None

        rows = _data(response)
        if not rows:
            raise SettingsVersionConflict("Routing settings version conflict.")
        _validate_routing_response(rows[0], payload)
        try:
            return _routing_from_row(rows[0])
        except Exception:
            raise _store_error() from None

    def _get_routing_row(self, user_id: str) -> dict[str, Any] | None:
        response = (
            self._client.table("user_ai_settings")
            .select(_ROUTING_COLUMNS)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = _data(response)
        return rows[0] if rows else None


_CREDENTIAL_COLUMNS = (
    "provider_slug,ciphertext,nonce,key_version,masked_suffix,base_url,"
    "connection_state,tested_at"
)
_ROUTING_COLUMNS = (
    "user_id,primary_provider_slug,primary_model,fallbacks,version"
)


def _credential_payload(
    user_id: str, record: ProviderCredentialRecord
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "provider_slug": record.provider_slug,
        "ciphertext": record.encrypted.ciphertext,
        "nonce": record.encrypted.nonce,
        "key_version": record.encrypted.key_version,
        "masked_suffix": record.encrypted.masked_suffix,
        "base_url": record.base_url,
        "connection_state": record.connection_state,
        "tested_at": record.tested_at.isoformat() if record.tested_at else None,
        "updated_at": _utc_now_iso(),
    }


def _credential_from_row(row: dict[str, Any]) -> ProviderCredentialRecord:
    tested_at = row.get("tested_at")
    if isinstance(tested_at, str):
        tested_at = datetime.fromisoformat(tested_at.replace("Z", "+00:00"))
    return ProviderCredentialRecord(
        provider_slug=row["provider_slug"],
        encrypted=EncryptedCredential(
            ciphertext=row["ciphertext"],
            nonce=row["nonce"],
            key_version=row["key_version"],
            masked_suffix=row["masked_suffix"],
        ),
        base_url=row.get("base_url"),
        connection_state=row["connection_state"],
        tested_at=tested_at,
    )


def _routing_payload(
    user_id: str, settings: RoutingSettings, version: int
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "primary_provider_slug": settings.primary_provider_slug,
        "primary_model": settings.primary_model,
        "fallbacks": [
            {"provider_slug": target.provider_slug, "model": target.model}
            for target in settings.fallbacks
        ],
        "version": version,
        "updated_at": _utc_now_iso(),
    }


def _routing_from_row(row: dict[str, Any]) -> RoutingSettings:
    return RoutingSettings(
        primary_provider_slug=row.get("primary_provider_slug"),
        primary_model=row.get("primary_model"),
        fallbacks=tuple(
            RouteTarget(item["provider_slug"], item["model"])
            for item in row.get("fallbacks", [])
        ),
        version=row["version"],
    )


def _validate_routing_response(
    row: dict[str, Any], expected: dict[str, Any]
) -> None:
    state_fields = {
        "user_id",
        "primary_provider_slug",
        "primary_model",
        "fallbacks",
        "version",
    }
    if not isinstance(row, dict) or not state_fields <= row.keys():
        raise _store_error()
    if any(row[key] != expected[key] for key in state_fields):
        raise SettingsVersionConflict("Routing settings version conflict.")


def _data(response: Any) -> list[dict[str, Any]]:
    return getattr(response, "data", None) or []


def _store_error() -> SettingsStoreError:
    return SettingsStoreError("Settings store operation failed.")


def _is_unique_conflict(exc: Exception) -> bool:
    try:
        return getattr(exc, "code", None) == "23505"
    except Exception:
        return False


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
