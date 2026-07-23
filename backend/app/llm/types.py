from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Literal, Mapping


FailureCategory = Literal[
    "auth", "timeout", "rate_limited", "unavailable", "invalid_response", "configuration"
]
_FAILURE_CATEGORIES = frozenset(
    {"auth", "timeout", "rate_limited", "unavailable", "invalid_response", "configuration"}
)
_SAFE_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SAFE_SCHEMA_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _nonempty(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _freeze_json(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        if any(not isinstance(key, str) for key in value):
            raise ValueError("user_json object keys must be strings")
        return MappingProxyType({key: _freeze_json(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(item) for item in value)
    raise ValueError("user_json must contain only JSON-compatible values")


class _FrozenJsonObject(dict[str, Any]):
    def _immutable(self, *_args: Any, **_kwargs: Any) -> None:
        raise TypeError("frozen JSON object is immutable")

    __setitem__ = _immutable
    __delitem__ = _immutable
    clear = _immutable
    pop = _immutable
    popitem = _immutable
    setdefault = _immutable
    update = _immutable
    __ior__ = _immutable


def _freeze_schema_json(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        if any(not isinstance(key, str) for key in value):
            raise ValueError("output_schema object keys must be strings")
        return _FrozenJsonObject(
            {key: _freeze_schema_json(item) for key, item in value.items()}
        )
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_schema_json(item) for item in value)
    raise ValueError("output_schema must contain only JSON-compatible values")


def thaw_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [thaw_json(item) for item in value]
    return value


@dataclass(frozen=True)
class LlmRequest:
    provider_slug: str
    model: str
    api_key: str = field(repr=False)
    base_url: str
    system_prompt: str
    user_json: Mapping[str, Any]
    output_schema_name: str | None = None
    output_schema: Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        for name in ("provider_slug", "model", "api_key", "base_url", "system_prompt"):
            _nonempty(getattr(self, name), name)
        if not isinstance(self.user_json, Mapping):
            raise ValueError("user_json must be an object")
        frozen = _freeze_json(self.user_json)
        # Reject non-finite floats and other values Python's encoder accepts loosely.
        json.dumps(thaw_json(frozen), allow_nan=False)
        object.__setattr__(self, "user_json", frozen)
        if (self.output_schema_name is None) != (self.output_schema is None):
            raise ValueError("output schema name and schema must be provided together")
        if self.output_schema_name is None:
            return
        if not isinstance(self.output_schema_name, str) or _SAFE_SCHEMA_NAME.fullmatch(
            self.output_schema_name
        ) is None:
            raise ValueError("output_schema_name is invalid")
        if not isinstance(self.output_schema, Mapping):
            raise ValueError("output_schema must be an object")
        frozen_schema = _freeze_schema_json(self.output_schema)
        json.dumps(thaw_json(frozen_schema), allow_nan=False)
        object.__setattr__(self, "output_schema", frozen_schema)


@dataclass(frozen=True)
class LlmResult:
    text: str
    provider_slug: str
    model: str

    def __post_init__(self) -> None:
        _nonempty(self.text, "text")
        _nonempty(self.provider_slug, "provider_slug")
        _nonempty(self.model, "model")


class _SealedException(Exception):
    __slots__ = ("_sealed",)

    def _seal(self) -> None:
        object.__setattr__(self, "_sealed", True)

    def __getattribute__(self, name: str) -> Any:
        value = super().__getattribute__(name)
        if name == "__dict__":
            return MappingProxyType(value)
        return value

    def __setattr__(self, name: str, value: Any) -> None:
        if getattr(self, "_sealed", False):
            raise AttributeError(f"{type(self).__name__} is immutable")
        super().__setattr__(name, value)

    def __delattr__(self, name: str) -> None:
        if getattr(self, "_sealed", False):
            raise AttributeError(f"{type(self).__name__} is immutable")
        super().__delattr__(name)


def _safe_slug(value: Any) -> str:
    if not isinstance(value, str) or _SAFE_SLUG.fullmatch(value) is None:
        raise ValueError("provider_slug is invalid")
    return value


def _safe_category(value: Any) -> FailureCategory:
    if value not in _FAILURE_CATEGORIES:
        raise ValueError("invalid provider failure category")
    return value


class ProviderFailure(_SealedException):
    __slots__ = ("provider_slug", "category", "retriable")

    def __init__(self, provider_slug: str, category: FailureCategory, retriable: bool):
        self.provider_slug = _safe_slug(provider_slug)
        self.category = _safe_category(category)
        if type(retriable) is not bool:
            raise ValueError("retriable must be a boolean")
        self.retriable = retriable
        super().__init__(f"{provider_slug}: {category}")
        self._seal()

    def __repr__(self) -> str:
        return f"ProviderFailure(provider_slug={self.provider_slug!r}, category={self.category!r}, retriable={self.retriable!r})"

@dataclass(frozen=True)
class AttemptFailure:
    provider_slug: str
    category: FailureCategory

    def __post_init__(self) -> None:
        _safe_slug(self.provider_slug)
        _safe_category(self.category)


class AllProvidersFailed(_SealedException):
    __slots__ = ("attempts",)

    def __init__(self, attempts: tuple[AttemptFailure, ...] | list[AttemptFailure]):
        try:
            copied = tuple(attempts)
        except TypeError:
            raise TypeError("attempts must be an iterable of AttemptFailure") from None
        if not copied or any(not isinstance(item, AttemptFailure) for item in copied):
            raise ValueError("attempts must contain AttemptFailure values")
        self.attempts = tuple(AttemptFailure(item.provider_slug, item.category) for item in copied)
        super().__init__("; ".join(f"{item.provider_slug}: {item.category}" for item in self.attempts))
        self._seal()

    def __repr__(self) -> str:
        values = ", ".join(f"{a.provider_slug}:{a.category}" for a in self.attempts)
        return f"AllProvidersFailed({values})"

class AiConfigurationRequired(_SealedException):
    def __init__(self) -> None:
        super().__init__("AI provider configuration is required.")
        self._seal()
