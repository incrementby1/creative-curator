from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.security.credential_cipher import EncryptedCredential


ConnectionState = Literal["connected", "needs_attention"]


class SettingsStoreError(Exception):
    """Raised when settings persistence cannot complete safely."""


class SettingsVersionConflict(SettingsStoreError):
    """Raised when routing settings changed since the caller read them."""


class SettingsProviderNotConnected(SettingsStoreError):
    """Raised when atomic routing validation finds a disconnected target."""


@dataclass(frozen=True)
class ProviderCredentialRecord:
    provider_slug: str
    encrypted: EncryptedCredential
    base_url: str | None = None
    connection_state: ConnectionState = "connected"
    tested_at: datetime | None = None

    def __post_init__(self) -> None:
        _require_nonempty(self.provider_slug, "provider_slug")
        if self.connection_state not in ("connected", "needs_attention"):
            raise ValueError("connection_state is invalid.")


@dataclass(frozen=True)
class ProviderConnection:
    provider_slug: str
    masked_suffix: str
    base_url: str | None = None
    connection_state: ConnectionState = "connected"
    tested_at: datetime | None = None

    def __post_init__(self) -> None:
        _require_nonempty(self.provider_slug, "provider_slug")
        if self.connection_state not in ("connected", "needs_attention"):
            raise ValueError("connection_state is invalid.")


@dataclass(frozen=True)
class RouteTarget:
    provider_slug: str
    model: str

    def __post_init__(self) -> None:
        _require_nonempty(self.provider_slug, "provider_slug")
        _require_nonempty(self.model, "model")


@dataclass(frozen=True)
class RoutingSettings:
    primary_provider_slug: str | None = None
    primary_model: str | None = None
    fallbacks: tuple[RouteTarget, ...] = ()
    version: int = 1

    def __post_init__(self) -> None:
        if not isinstance(self.fallbacks, (list, tuple)):
            raise ValueError("fallbacks must be a list or tuple of RouteTarget values.")
        normalized_fallbacks = tuple(self.fallbacks)
        if any(not isinstance(target, RouteTarget) for target in normalized_fallbacks):
            raise ValueError("fallbacks must contain only RouteTarget values.")
        object.__setattr__(self, "fallbacks", normalized_fallbacks)
        if (self.primary_provider_slug is None) != (self.primary_model is None):
            raise ValueError("Primary provider and model must be set together.")
        if self.primary_provider_slug is not None:
            _require_nonempty(self.primary_provider_slug, "primary_provider_slug")
        if self.primary_model is not None:
            _require_nonempty(self.primary_model, "primary_model")
        if len(self.fallbacks) > 5:
            raise ValueError("At most five fallback targets are allowed.")
        if len(set(self.fallbacks)) != len(self.fallbacks):
            raise ValueError("Fallback targets must be unique.")
        if not isinstance(self.version, int) or self.version < 1:
            raise ValueError("version must be at least 1.")


def _require_nonempty(value: str, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string.")
