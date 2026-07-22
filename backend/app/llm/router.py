from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.llm.transports import LlmDispatcher, resolve_provider_route
from app.llm.types import (
    AiConfigurationRequired,
    AllProvidersFailed,
    AttemptFailure,
    LlmRequest,
    ProviderFailure,
)
from app.persistence.settings_store import SettingsStore
from app.security.credential_cipher import CredentialCipher, CredentialDecryptionError
from app.settings.provider_registry import ProviderNotFound, ProviderRegistry
from app.settings.types import ProviderCredentialRecord, RouteTarget


TOutput = TypeVar("TOutput", bound=BaseModel)


@dataclass(frozen=True)
class _PreparedCall:
    request: LlmRequest
    transport: str
    credential: ProviderCredentialRecord


class _CredentialFailure(Exception):
    def __init__(self, credential: ProviderCredentialRecord):
        self.credential = credential
        super().__init__("Credential could not be decrypted.")


class StructuredLlmRouter:
    def __init__(self, settings: SettingsStore, cipher: CredentialCipher,
                 registry: ProviderRegistry, dispatcher: LlmDispatcher):
        self._settings = settings
        self._cipher = cipher
        self._registry = registry
        self._dispatcher = dispatcher

    def generate(self, user_id: str, output_model: type[TOutput], system_prompt: str,
                 user_json: dict[str, Any]) -> TOutput:
        routing_failed = False
        try:
            routing = self._settings.get_routing(user_id)
        except Exception:
            routing_failed = True
            routing = None
        if routing_failed:
            raise AllProvidersFailed((AttemptFailure("settings", "configuration"),))
        assert routing is not None
        if not routing.primary_provider_slug or not routing.primary_model:
            raise AiConfigurationRequired() from None
        primary = RouteTarget(routing.primary_provider_slug, routing.primary_model)
        targets: list[RouteTarget] = []
        for target in (primary, *tuple(routing.fallbacks)[:5]):
            if target not in targets:
                targets.append(target)
        attempts: list[AttemptFailure] = []
        for target in targets:
            prepared: _PreparedCall | None = None
            try:
                prepared = self._prepare_call(
                    user_id, target, system_prompt, user_json
                )
                result = self._dispatcher.dispatch(
                    prepared.request, prepared.transport
                )
            except _CredentialFailure as failure:
                attempts.append(AttemptFailure(target.provider_slug, "auth"))
                self._mark_attention(user_id, failure.credential)
                continue
            except ProviderFailure as failure:
                attempts.append(AttemptFailure(target.provider_slug, failure.category))
                if failure.category == "auth" and prepared is not None:
                    self._mark_attention(user_id, prepared.credential)
                continue
            try:
                return output_model.model_validate_json(result.text, strict=True)
            except (ValidationError, ValueError, TypeError) as invalid:
                repair_prepared: _PreparedCall | None = None
                try:
                    repair_prepared = self._prepare_repair(
                        user_id, target, system_prompt, user_json, result.text, invalid
                    )
                    repaired = self._dispatcher.dispatch(
                        repair_prepared.request, repair_prepared.transport
                    )
                    return output_model.model_validate_json(repaired.text, strict=True)
                except _CredentialFailure as failure:
                    attempts.append(AttemptFailure(target.provider_slug, "auth"))
                    self._mark_attention(user_id, failure.credential)
                except ProviderFailure as failure:
                    attempts.append(AttemptFailure(target.provider_slug, failure.category))
                    if failure.category == "auth" and repair_prepared is not None:
                        self._mark_attention(user_id, repair_prepared.credential)
                except (ValidationError, ValueError, TypeError):
                    attempts.append(AttemptFailure(target.provider_slug, "invalid_response"))
                continue
        raise AllProvidersFailed(attempts) from None

    def _target_parts(self, user_id: str, target: RouteTarget):
        try:
            provider = self._registry.get(target.provider_slug)
        except (ProviderNotFound, KeyError):
            raise ProviderFailure(target.provider_slug, "configuration", False) from None
        try:
            record = self._settings.get_credential(user_id, target.provider_slug)
        except Exception:
            raise ProviderFailure(target.provider_slug, "configuration", False) from None
        if record is None:
            raise ProviderFailure(target.provider_slug, "configuration", False) from None
        try:
            key = self._cipher.decrypt(user_id, target.provider_slug, record.encrypted)
        except CredentialDecryptionError:
            raise _CredentialFailure(record) from None
        route = resolve_provider_route(provider, target.model, key, record.base_url)
        return key, route, record

    def _prepare_call(self, user_id: str, target: RouteTarget, system_prompt: str,
                      user_json: dict[str, Any]) -> _PreparedCall:
        key, route, record = self._target_parts(user_id, target)
        request = LlmRequest(target.provider_slug, target.model, key, route.base_url,
                             system_prompt, user_json)
        return _PreparedCall(request, route.transport, record)

    def _prepare_repair(self, user_id: str, target: RouteTarget, system_prompt: str,
                        user_json: dict[str, Any], invalid_text: str,
                        invalid: Exception) -> _PreparedCall:
        key, route, record = self._target_parts(user_id, target)
        summary = _validation_summary(invalid)
        prompt = (
            f"{system_prompt}\n\nCorrect the prior response. Return only strict JSON matching the requested schema. "
            f"Validation: {summary}"
        )
        repair_data = {"original_user_data": user_json, "invalid_response": invalid_text[:2048]}
        request = LlmRequest(
            target.provider_slug, target.model, key, route.base_url, prompt, repair_data
        )
        return _PreparedCall(request, route.transport, record)

    def _mark_attention(
        self, user_id: str, credential: ProviderCredentialRecord
    ) -> None:
        try:
            self._settings.mark_credential_state(
                user_id, credential, "needs_attention"
            )
        except Exception:
            return


def _validation_summary(error: Exception) -> str:
    if isinstance(error, ValidationError):
        pieces = []
        for item in error.errors(include_url=False, include_context=False, include_input=False)[:8]:
            location = ".".join(str(part) for part in item.get("loc", ())) or "root"
            pieces.append(f"{location}:{item.get('type', 'invalid')}")
        return ", ".join(pieces)[:512]
    return "invalid_json"
