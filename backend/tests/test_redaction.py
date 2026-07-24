import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.security.redaction import redact_sensitive


class RedactionTests(unittest.TestCase):
    def test_redaction_removes_credentials_from_nested_log_context(self) -> None:
        original = {
            "event": "provider_test",
            "nested": [
                {"Authorization": "Bearer secret"},
                ({"api_KEY": "sk-secret", "safe": "kept"},),
            ],
            "access_token": "access-secret",
            "refresh_token": "refresh-secret",
            "service_role_key": "role-secret",
            "MASTER_KEY": "master-secret",
            "password": "password-secret",
            "ciphertext": "cipher-secret",
            "NONCE": "nonce-secret",
        }

        redacted = redact_sensitive(original)

        self.assertEqual(redacted["event"], "provider_test")
        self.assertEqual(redacted["nested"][0]["Authorization"], "[REDACTED]")
        self.assertEqual(redacted["nested"][1][0]["api_KEY"], "[REDACTED]")
        self.assertEqual(redacted["nested"][1][0]["safe"], "kept")
        for key in (
            "access_token",
            "refresh_token",
            "service_role_key",
            "MASTER_KEY",
            "password",
            "ciphertext",
            "NONCE",
        ):
            self.assertEqual(redacted[key], "[REDACTED]")

    def test_redaction_returns_copy_without_mutating_input(self) -> None:
        original = {"details": [{"api_key": "secret", "tags": ["one"]}]}

        redacted = redact_sensitive(original)
        redacted["details"][0]["tags"].append("two")

        self.assertEqual(original, {"details": [{"api_key": "secret", "tags": ["one"]}]})
        self.assertIsNot(redacted, original)
        self.assertIsInstance(redacted["details"], list)

    def test_tuples_remain_tuples(self) -> None:
        redacted = redact_sensitive(({"password": "secret"}, "safe"))

        self.assertEqual(redacted, ({"password": "[REDACTED]"}, "safe"))
        self.assertIsInstance(redacted, tuple)


if __name__ == "__main__":
    unittest.main()
