from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Protocol

from app.llm.transports import LlmDispatcher, resolve_provider_route
from app.llm.types import LlmRequest, ProviderFailure
from app.persistence.settings_store import SettingsStore
from app.security.credential_cipher import CredentialCipher, CredentialDecryptionError
from app.settings.provider_registry import (
    ProviderManifestError,
    ProviderMetadata,
    ProviderNotFound,
    ProviderRegistry,
    validate_provider_url,
)
from app.settings.types import (
    ConnectionState,
    ProviderCredentialRecord,
    RouteTarget,
    RoutingSettings,
    SettingsProviderNotConnected,
)


class ProviderOperations(Protocol):
    def test_connection(
        self,
        provider: ProviderMetadata,
        api_key: str,
        model: str,
        base_url: str | None,
    ) -> None: ...

    def discover_models(
        self,
        provider: ProviderMetadata,
        api_key: str,
        base_url: str | None,
    ) -> list[str]: ...


class SettingsServiceError(Exception):
    code = "settings_error"


class ProviderUnknown(SettingsServiceError):
    code = "provider_not_found"


class ProviderNotConnected(SettingsServiceError):
    code = "provider_not_connected"


class ProviderInUse(SettingsServiceError):
    code = "provider_in_use"


class InvalidProviderConfiguration(SettingsServiceError):
    code = "invalid_provider_configuration"


class ProviderConnectionFailed(SettingsServiceError):
    code = "provider_connection_failed"

    def __init__(self, category: str) -> None:
        self.category = category
        super().__init__(self.code)


class TransportProviderOperations:
    def __init__(self, dispatcher: LlmDispatcher) -> None:
        self._dispatcher = dispatcher

    def test_connection(
        self,
        provider: ProviderMetadata,
        api_key: str,
        model: str,
        base_url: str | None,
    ) -> None:
        if provider.model_discovery.supported:
            self.discover_models(provider, api_key, base_url)
            return
        route = resolve_provider_route(provider, model, api_key, base_url)
        request = LlmRequest(
            provider_slug=provider.slug,
            model=model,
            api_key=api_key,
            base_url=route.base_url,
            system_prompt="Reply with OK.",
            user_json={"operation": "connection_test"},
        )
        self._dispatcher.dispatch(request, route.transport)

    def discover_models(
        self,
        provider: ProviderMetadata,
        api_key: str,
        base_url: str | None,
    ) -> list[str]:
        endpoint = _validated_base_url(provider, base_url)
        return self._dispatcher.discover_models(
            provider_slug=provider.slug,
            strategy=provider.model_discovery.strategy,
            api_key=api_key,
            base_url=endpoint,
        )

    def close(self) -> None:
        self._dispatcher.close()


class DeterministicTestProviderOperations:
    """Offline provider behavior reachable only through guarded test composition."""

    _KEY_PATTERN = re.compile(r"test-[A-Za-z0-9][A-Za-z0-9._-]{0,127}")

    def test_connection(
        self,
        provider: ProviderMetadata,
        api_key: str,
        model: str,
        base_url: str | None,
    ) -> None:
        if self._KEY_PATTERN.fullmatch(api_key) is None:
            raise ProviderFailure(provider.slug, "auth", False) from None

    def discover_models(
        self,
        provider: ProviderMetadata,
        api_key: str,
        base_url: str | None,
    ) -> list[str]:
        if self._KEY_PATTERN.fullmatch(api_key) is None:
            raise ProviderFailure(provider.slug, "auth", False) from None
        return [f"{provider.slug}-test-model"]


class SettingsService:
    def __init__(
        self,
        *,
        store: SettingsStore,
        cipher: CredentialCipher,
        registry: ProviderRegistry,
        operations: ProviderOperations,
    ) -> None:
        self._store = store
        self._cipher = cipher
        self.registry = registry
        self._operations = operations

    def close(self) -> None:
        close = getattr(self._operations, "close", None)
        if callable(close):
            close()

    def provider_catalog(self, user_id: str) -> dict:
        connected = {
            item.provider_slug: item for item in self._store.list_credentials(user_id)
        }
        providers = []
        for provider in self.registry.providers:
            record = connected.get(provider.slug)
            providers.append({
                "slug": provider.slug,
                "display_name": provider.display_name,
                "key_names": list(provider.key_names),
                "default_base_url": provider.default_base_url,
                "base_url_env_names": list(provider.base_url_env_names),
                "requires_custom_base_url": provider.requires_custom_base_url,
                "model_discovery_supported": provider.model_discovery.supported,
                "manual_model_entry": provider.manual_model_entry,
                "state": record.connection_state if record else "not_connected",
                "masked_suffix": record.encrypted.masked_suffix if record else None,
                "configured_base_url": record.base_url if record else None,
                "tested_at": _iso(record.tested_at) if record else None,
            })
        return {"manifest_version": self.registry.manifest_version, "providers": providers}

    def test_connection(
        self,
        user_id: str,
        provider_slug: str,
        api_key: str | None,
        model: str,
        base_url: str | None,
        *,
        use_stored_base_url: bool = True,
    ) -> None:
        provider = self._provider(provider_slug)
        key, effective_base_url, stored_record = self._resolve_access(
            user_id,
            provider_slug,
            api_key,
            base_url,
            use_stored_base_url=use_stored_base_url,
        )
        _validate_connection_target(provider, model, key, effective_base_url)
        try:
            self._operations.test_connection(provider, key, model, effective_base_url)
        except ProviderFailure as exc:
            if exc.category == "auth" and stored_record is not None:
                self._mark_state(user_id, stored_record, "needs_attention")
            raise ProviderConnectionFailed(exc.category) from None
        except SettingsServiceError:
            raise
        except Exception:
            raise ProviderConnectionFailed("invalid_response") from None
        if (
            stored_record is not None
            and stored_record.connection_state == "needs_attention"
        ):
            self._mark_state(user_id, stored_record, "connected")

    def discover_models(
        self,
        user_id: str,
        provider_slug: str,
        api_key: str | None,
        base_url: str | None,
    ) -> dict:
        provider = self._provider(provider_slug)
        if not provider.model_discovery.supported:
            return {"models": [], "manual_entry_required": True}
        key, effective_base_url, stored_record = self._resolve_access(
            user_id, provider_slug, api_key, base_url, use_stored_base_url=True
        )
        _validated_base_url(provider, effective_base_url)
        try:
            models = self._operations.discover_models(
                provider, key, effective_base_url
            )
        except ProviderFailure as exc:
            if exc.category == "auth" and stored_record is not None:
                self._mark_state(user_id, stored_record, "needs_attention")
            raise ProviderConnectionFailed(exc.category) from None
        except SettingsServiceError:
            raise
        except Exception:
            raise ProviderConnectionFailed("invalid_response") from None
        if (
            stored_record is not None
            and stored_record.connection_state == "needs_attention"
        ):
            self._mark_state(user_id, stored_record, "connected")
        normalized = sorted(
            {
                item.strip()
                for item in models
                if isinstance(item, str) and item.strip()
            }
        )
        return {"models": normalized, "manual_entry_required": not normalized}

    def save_provider(
        self,
        user_id: str,
        provider_slug: str,
        api_key: str,
        model: str,
        base_url: str | None,
    ) -> dict:
        self.test_connection(
            user_id,
            provider_slug,
            api_key,
            model,
            base_url,
            use_stored_base_url=False,
        )
        encrypted = self._cipher.encrypt(user_id, provider_slug, api_key)
        now = datetime.now(timezone.utc)
        record = self._store.upsert_credential(
            user_id,
            ProviderCredentialRecord(
                provider_slug=provider_slug,
                encrypted=encrypted,
                base_url=base_url,
                connection_state="connected",
                tested_at=now,
            ),
        )
        return _connection_response(record)

    def delete_provider(self, user_id: str, provider_slug: str) -> None:
        self._provider(provider_slug)
        result = self._store.delete_credential_if_unreferenced(
            user_id, provider_slug
        )
        if result == "in_use":
            raise ProviderInUse

    def get_routing(self, user_id: str) -> dict:
        return _routing_response(self._store.get_routing(user_id))

    def save_routing(
        self,
        user_id: str,
        primary: RouteTarget | None,
        fallbacks: tuple[RouteTarget, ...],
        version: int,
    ) -> dict:
        if primary is None and fallbacks:
            raise InvalidProviderConfiguration("Fallbacks require a primary provider.")
        if primary is not None and primary in fallbacks:
            raise ValueError("Primary route cannot also be a fallback.")
        targets = (() if primary is None else (primary,)) + fallbacks
        for target in targets:
            try:
                self._provider(target.provider_slug)
            except ProviderUnknown:
                raise InvalidProviderConfiguration(
                    "Routing target provider is unknown."
                ) from None
        settings = RoutingSettings(
            primary_provider_slug=primary.provider_slug if primary else None,
            primary_model=primary.model if primary else None,
            fallbacks=fallbacks,
            version=version,
        )
        try:
            saved = self._store.save_routing_if_connected(user_id, settings)
        except SettingsProviderNotConnected:
            raise ProviderNotConnected("provider_not_connected") from None
        return _routing_response(saved)

    def _provider(self, slug: str) -> ProviderMetadata:
        try:
            return self.registry.get(slug)
        except (ProviderNotFound, KeyError):
            raise ProviderUnknown(slug) from None

    def _resolve_access(
        self,
        user_id: str,
        provider_slug: str,
        api_key: str | None,
        base_url: str | None,
        *,
        use_stored_base_url: bool,
    ) -> tuple[str, str | None, ProviderCredentialRecord | None]:
        if api_key is not None:
            return api_key, base_url, None
        record = self._store.get_credential(user_id, provider_slug)
        if record is None:
            raise ProviderNotConnected(provider_slug)
        try:
            api_key = self._cipher.decrypt(
                user_id, provider_slug, record.encrypted
            )
        except CredentialDecryptionError:
            raise ProviderNotConnected(provider_slug) from None
        effective_base_url = base_url
        if effective_base_url is None and use_stored_base_url:
            effective_base_url = record.base_url
        return api_key, effective_base_url, record

    def _mark_state(
        self,
        user_id: str,
        record: ProviderCredentialRecord,
        state: ConnectionState,
    ) -> None:
        try:
            self._store.mark_credential_state(user_id, record, state)
        except Exception:
            return


def _validated_base_url(provider: ProviderMetadata, supplied: str | None) -> str:
    if (
        supplied is not None
        and not provider.base_url_env_names
        and not provider.requires_custom_base_url
    ):
        raise InvalidProviderConfiguration(
            "Provider does not support endpoint overrides."
        )
    endpoint = supplied or provider.default_base_url
    if endpoint is None:
        raise InvalidProviderConfiguration("Provider requires a custom endpoint.")
    try:
        return validate_provider_url(endpoint)
    except ProviderManifestError:
        raise InvalidProviderConfiguration("Provider endpoint is invalid.") from None


def _validate_connection_target(
    provider: ProviderMetadata,
    model: str,
    api_key: str,
    base_url: str | None,
) -> None:
    _validated_base_url(provider, base_url)
    try:
        resolve_provider_route(provider, model, api_key, base_url)
    except ProviderFailure as exc:
        raise InvalidProviderConfiguration(exc.category) from None


def _connection_response(record: ProviderCredentialRecord) -> dict:
    return {
        "provider_slug": record.provider_slug,
        "state": record.connection_state,
        "masked_suffix": record.encrypted.masked_suffix,
        "configured_base_url": record.base_url,
        "tested_at": _iso(record.tested_at),
    }


def _routing_response(settings: RoutingSettings) -> dict:
    primary = None
    if settings.primary_provider_slug is not None:
        primary = {
            "provider_slug": settings.primary_provider_slug,
            "model": settings.primary_model,
        }
    return {
        "primary": primary,
        "fallbacks": [
            {"provider_slug": target.provider_slug, "model": target.model}
            for target in settings.fallbacks
        ],
        "version": settings.version,
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
