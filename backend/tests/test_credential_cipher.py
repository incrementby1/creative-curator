import base64
import dataclasses
import json
import sys
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.security.credential_cipher import (
    CredentialCipher,
    CredentialDecryptionError,
    EncryptedCredential,
)


class CredentialCipherTests(unittest.TestCase):
    def test_cipher_binds_secret_to_user_and_provider(self) -> None:
        cipher = CredentialCipher(b"k" * 32)
        encrypted = cipher.encrypt("user-a", "openrouter", "sk-secret")

        self.assertEqual(
            cipher.decrypt("user-a", "openrouter", encrypted), "sk-secret"
        )
        with self.assertRaises(CredentialDecryptionError):
            cipher.decrypt("user-b", "openrouter", encrypted)
        with self.assertRaises(CredentialDecryptionError):
            cipher.decrypt("user-a", "anthropic", encrypted)

    def test_aad_encoding_cannot_collide_on_delimiters(self) -> None:
        cipher = CredentialCipher(b"k" * 32)
        encrypted = cipher.encrypt("a:b", "c", "secret-one")

        with self.assertRaises(CredentialDecryptionError):
            cipher.decrypt("a", "b:c", encrypted)

    def test_encryption_uses_unique_nonce_and_masks_only_suffix(self) -> None:
        cipher = CredentialCipher(b"k" * 32)
        first = cipher.encrypt("user-a", "openrouter", "sk-secret-4F2A")
        second = cipher.encrypt("user-a", "openrouter", "sk-secret-4F2A")

        self.assertNotEqual(first.nonce, second.nonce)
        self.assertEqual(first.masked_suffix, "4F2A")
        self.assertNotIn("secret", first.ciphertext)

    def test_wrong_master_key_cannot_decrypt(self) -> None:
        encrypted = CredentialCipher(b"a" * 32).encrypt(
            "user-a", "openrouter", "sk-secret"
        )

        with self.assertRaises(CredentialDecryptionError):
            CredentialCipher(b"b" * 32).decrypt("user-a", "openrouter", encrypted)

    def test_master_key_must_be_exactly_32_bytes(self) -> None:
        for key in (b"", b"k" * 31, b"k" * 33):
            with self.subTest(length=len(key)):
                with self.assertRaises(ValueError):
                    CredentialCipher(key)

    def test_unicode_secret_round_trips(self) -> None:
        cipher = CredentialCipher(b"k" * 32)
        encrypted = cipher.encrypt("user-雪", "provider-🌍", "秘密🔐café")

        self.assertEqual(
            cipher.decrypt("user-雪", "provider-🌍", encrypted),
            "秘密🔐café",
        )

    def test_empty_identity_provider_or_secret_is_rejected(self) -> None:
        cipher = CredentialCipher(b"k" * 32)
        for user_id, provider_slug, secret in (
            ("", "openrouter", "secret"),
            ("user-a", "", "secret"),
            ("user-a", "openrouter", ""),
        ):
            with self.subTest(
                user_id=user_id, provider_slug=provider_slug, secret=secret
            ):
                with self.assertRaises(ValueError):
                    cipher.encrypt(user_id, provider_slug, secret)

    def test_short_secrets_are_never_fully_exposed(self) -> None:
        cipher = CredentialCipher(b"k" * 32)

        for secret in ("a", "abcd"):
            with self.subTest(secret=secret):
                self.assertEqual(
                    cipher.encrypt("user-a", "openrouter", secret).masked_suffix,
                    "",
                )

    def test_record_repr_hides_ciphertext_and_nonce(self) -> None:
        record = EncryptedCredential(
            ciphertext="sensitive-ciphertext",
            nonce="sensitive-nonce",
            key_version=1,
            masked_suffix="cret",
        )

        representation = repr(record)
        self.assertNotIn("sensitive-ciphertext", representation)
        self.assertNotIn("sensitive-nonce", representation)
        self.assertTrue(dataclasses.is_dataclass(record))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            record.key_version = 2  # type: ignore[misc]

    def test_malformed_encrypted_values_raise_generic_error(self) -> None:
        cipher = CredentialCipher(b"k" * 32)
        valid = cipher.encrypt("user-a", "openrouter", "secret")
        malformed = (
            dataclasses.replace(valid, ciphertext="not base64!"),
            dataclasses.replace(valid, nonce="not base64!"),
            dataclasses.replace(
                valid, nonce=base64.b64encode(b"short").decode("ascii")
            ),
            dataclasses.replace(valid, ciphertext=valid.ciphertext[:-2] + "AA"),
        )

        for encrypted in malformed:
            with self.subTest(encrypted=repr(encrypted)):
                with self.assertRaisesRegex(
                    CredentialDecryptionError, "Unable to decrypt credential"
                ):
                    cipher.decrypt("user-a", "openrouter", encrypted)

    def test_unsupported_key_version_raises_generic_error(self) -> None:
        cipher = CredentialCipher(b"k" * 32)
        encrypted = cipher.encrypt("user-a", "openrouter", "secret")

        with self.assertRaises(CredentialDecryptionError):
            cipher.decrypt(
                "user-a", "openrouter", dataclasses.replace(encrypted, key_version=2)
            )

    def test_noncanonical_base64_is_rejected(self) -> None:
        cipher = CredentialCipher(b"k" * 32)
        encrypted = cipher.encrypt("user-a", "openrouter", "secret")

        with self.assertRaises(CredentialDecryptionError):
            cipher.decrypt(
                "user-a",
                "openrouter",
                dataclasses.replace(encrypted, nonce=encrypted.nonce + "="),
            )

    def test_authenticated_non_utf8_plaintext_does_not_leak_through_cause(self) -> None:
        key = b"k" * 32
        nonce = b"n" * 12
        plaintext = b"private-non-utf8-\xff"
        aad = json.dumps(
            {
                "key_version": 1,
                "provider_slug": "openrouter",
                "user_id": "user-a",
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        encrypted = EncryptedCredential(
            ciphertext=base64.b64encode(
                AESGCM(key).encrypt(nonce, plaintext, aad)
            ).decode("ascii"),
            nonce=base64.b64encode(nonce).decode("ascii"),
            key_version=1,
            masked_suffix="",
        )

        try:
            CredentialCipher(key).decrypt("user-a", "openrouter", encrypted)
        except CredentialDecryptionError as exc:
            self.assertIsNone(exc.__cause__)
            self.assertIsNone(exc.__context__)
            self.assertNotIn(repr(plaintext), repr(exc.__cause__))
            self.assertNotIn(repr(plaintext), repr(exc.__context__))
        else:
            self.fail("CredentialDecryptionError was not raised")


if __name__ == "__main__":
    unittest.main()
