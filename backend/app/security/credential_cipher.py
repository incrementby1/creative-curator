from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


_KEY_VERSION = 1
_NONCE_LENGTH = 12


class CredentialDecryptionError(Exception):
    """Raised when an encrypted credential cannot be safely decrypted."""


@dataclass(frozen=True)
class EncryptedCredential:
    ciphertext: str = field(repr=False)
    nonce: str = field(repr=False)
    key_version: int
    masked_suffix: str


class CredentialCipher:
    def __init__(self, master_key: bytes) -> None:
        if not isinstance(master_key, bytes) or len(master_key) != 32:
            raise ValueError("Master key must be exactly 32 bytes.")
        self._cipher = AESGCM(master_key)

    def encrypt(
        self, user_id: str, provider_slug: str, plaintext: str
    ) -> EncryptedCredential:
        _require_nonempty(user_id, "user_id")
        _require_nonempty(provider_slug, "provider_slug")
        _require_nonempty(plaintext, "plaintext")
        nonce = os.urandom(_NONCE_LENGTH)
        encoded = plaintext.encode("utf-8")
        ciphertext = self._cipher.encrypt(
            nonce,
            encoded,
            _aad(user_id, provider_slug, _KEY_VERSION),
        )
        suffix = plaintext[-4:] if len(plaintext) > 4 else ""
        return EncryptedCredential(
            ciphertext=base64.b64encode(ciphertext).decode("ascii"),
            nonce=base64.b64encode(nonce).decode("ascii"),
            key_version=_KEY_VERSION,
            masked_suffix=suffix,
        )

    def decrypt(
        self,
        user_id: str,
        provider_slug: str,
        encrypted: EncryptedCredential,
    ) -> str:
        try:
            _require_nonempty(user_id, "user_id")
            _require_nonempty(provider_slug, "provider_slug")
            if encrypted.key_version != _KEY_VERSION:
                raise ValueError("Unsupported key version.")
            nonce = _decode_base64(encrypted.nonce)
            ciphertext = _decode_base64(encrypted.ciphertext)
            if len(nonce) != _NONCE_LENGTH:
                raise ValueError("Invalid nonce length.")
            plaintext = self._cipher.decrypt(
                nonce,
                ciphertext,
                _aad(user_id, provider_slug, encrypted.key_version),
            )
        except Exception:
            raise CredentialDecryptionError("Unable to decrypt credential.") from None

        decoded: str | None = None
        try:
            decoded = plaintext.decode("utf-8")
        except UnicodeDecodeError:
            pass
        if decoded is None:
            raise CredentialDecryptionError("Unable to decrypt credential.") from None
        return decoded


def _aad(user_id: str, provider_slug: str, key_version: int) -> bytes:
    return json.dumps(
        {
            "key_version": key_version,
            "provider_slug": provider_slug,
            "user_id": user_id,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _require_nonempty(value: str, name: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string.")


def _decode_base64(value: str) -> bytes:
    decoded = base64.b64decode(value, validate=True)
    if base64.b64encode(decoded).decode("ascii") != value:
        raise ValueError("Noncanonical base64.")
    return decoded
