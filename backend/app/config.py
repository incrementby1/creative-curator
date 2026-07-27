from __future__ import annotations

import base64
import binascii
import os
from dataclasses import dataclass, field
from typing import Literal, cast

from app.persistence.local_supabase import require_local_supabase_url


AppEnv = Literal["development", "test", "production"]
AuthMode = Literal["supabase", "test"]
SettingsStoreMode = Literal["supabase", "memory"]
LlmTransportMode = Literal["live", "test"]


def _validated_mode(name: str, default: str, allowed: set[str]) -> str:
    value = os.getenv(name, default)
    if value not in allowed:
        choices = ", ".join(sorted(allowed))
        raise RuntimeError(f"{name} must be one of: {choices}")
    return value


@dataclass(frozen=True)
class RuntimeConfig:
    app_env: AppEnv
    auth_mode: AuthMode
    settings_store_mode: SettingsStoreMode
    llm_transport_mode: LlmTransportMode
    supabase_url: str
    supabase_anon_key: str = field(repr=False)
    supabase_service_role_key: str = field(repr=False)
    master_key: bytes = field(repr=False)

    @classmethod
    def from_env(cls) -> RuntimeConfig:
        app_env = cast(
            AppEnv,
            _validated_mode(
                "APP_ENV",
                "development",
                {"development", "test", "production"},
            ),
        )
        auth_mode = cast(
            AuthMode,
            _validated_mode("AUTH_MODE", "supabase", {"supabase", "test"}),
        )
        settings_store_mode = cast(
            SettingsStoreMode,
            _validated_mode(
                "SETTINGS_STORE_MODE", "supabase", {"supabase", "memory"}
            ),
        )
        llm_transport_mode = cast(
            LlmTransportMode,
            _validated_mode("LLM_TRANSPORT_MODE", "live", {"live", "test"}),
        )

        if app_env == "production" and (
            auth_mode == "test" or llm_transport_mode == "test"
        ):
            raise RuntimeError("test mode is not allowed in production")

        supabase_url = os.getenv("SUPABASE_URL", "")
        if auth_mode == "supabase" or settings_store_mode == "supabase":
            require_local_supabase_url(supabase_url)

        encoded_master_key = os.getenv("BYOK_MASTER_KEY", "")
        master_key = b""
        if encoded_master_key:
            try:
                master_key = base64.b64decode(encoded_master_key, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise RuntimeError("BYOK_MASTER_KEY must be valid base64") from exc
        if settings_store_mode == "supabase":
            if len(master_key) != 32:
                raise RuntimeError(
                    "BYOK_MASTER_KEY must decode to exactly 32 bytes"
                )

        return cls(
            app_env=app_env,
            auth_mode=auth_mode,
            settings_store_mode=settings_store_mode,
            llm_transport_mode=llm_transport_mode,
            supabase_url=supabase_url,
            supabase_anon_key=os.getenv("SUPABASE_ANON_KEY", ""),
            supabase_service_role_key=os.getenv(
                "SUPABASE_SERVICE_ROLE_KEY", ""
            ),
            master_key=master_key,
        )
