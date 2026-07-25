from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Mapping, TypeVar

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
        output_schema_name = _schema_name(output_model)
        output_schema = output_model.model_json_schema()
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
                    user_id, target, system_prompt, user_json,
                    output_schema_name, output_schema,
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
                return _validate_output(output_model, result.text)
            except (ValidationError, ValueError, TypeError) as invalid:
                repair_prepared: _PreparedCall | None = None
                try:
                    repair_prepared = self._prepare_repair(
                        user_id, target, system_prompt, user_json, result.text, invalid,
                        output_schema_name, output_schema,
                    )
                    repaired = self._dispatcher.dispatch(
                        repair_prepared.request, repair_prepared.transport
                    )
                    return _validate_output(output_model, repaired.text)
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
                      user_json: dict[str, Any], output_schema_name: str,
                      output_schema: Mapping[str, Any]) -> _PreparedCall:
        key, route, record = self._target_parts(user_id, target)
        request = LlmRequest(target.provider_slug, target.model, key, route.base_url,
                             system_prompt, user_json, output_schema_name,
                             output_schema)
        return _PreparedCall(request, route.transport, record)

    def _prepare_repair(self, user_id: str, target: RouteTarget, system_prompt: str,
                        user_json: dict[str, Any], invalid_text: str,
                        invalid: Exception, output_schema_name: str,
                        output_schema: Mapping[str, Any]) -> _PreparedCall:
        key, route, record = self._target_parts(user_id, target)
        summary = _validation_summary(invalid)
        prompt = (
            f"{system_prompt}\n\nCorrect the prior response. Return only strict JSON matching the requested schema. "
            f"Validation: {summary}"
        )
        repair_data = {"original_user_data": user_json, "invalid_response": invalid_text[:2048]}
        request = LlmRequest(
            target.provider_slug, target.model, key, route.base_url, prompt, repair_data,
            output_schema_name, output_schema,
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


def _schema_name(output_model: type[BaseModel]) -> str:
    name = re.sub(r"(?<!^)(?=[A-Z])", "_", output_model.__name__).lower()
    return name[:64]


_OUTER_JSON_FENCE = re.compile(
    r"```(?:json)?[ \t]*\r?\n(?P<body>.*?)\r?\n```",
    re.DOTALL,
)


def _validate_output(output_model: type[TOutput], text: str) -> TOutput:
    try:
        return output_model.model_validate_json(text, strict=True)
    except (ValidationError, ValueError, TypeError) as original:
        stripped = text.strip()
        fence = _OUTER_JSON_FENCE.fullmatch(stripped)
        candidate = fence.group("body") if fence is not None else stripped
        try:
            value = json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            raise original
        if isinstance(value, dict) and set(value) == {"output"}:
            value = value["output"]
        return output_model.model_validate(value, strict=True)
