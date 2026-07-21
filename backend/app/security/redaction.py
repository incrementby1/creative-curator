from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from typing import Any


_SENSITIVE_KEYS = {
    "authorization",
    "api_key",
    "access_token",
    "refresh_token",
    "service_role_key",
    "master_key",
    "password",
    "ciphertext",
    "nonce",
}
_REDACTED = "[REDACTED]"


def redact_sensitive(value: Any) -> Any:
    """Return a recursively redacted copy suitable for log context."""
    if isinstance(value, Mapping):
        return {
            deepcopy(key): (
                _REDACTED
                if isinstance(key, str) and key.casefold() in _SENSITIVE_KEYS
                else redact_sensitive(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_sensitive(item) for item in value)
    return deepcopy(value)
