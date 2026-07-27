from __future__ import annotations

import os
import sys
import tomllib
import unittest
from pathlib import Path
from uuid import uuid4


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.persistence.local_supabase import require_local_supabase_url
from app.persistence.settings_store import SupabaseSettingsStore
from app.security.credential_cipher import CredentialCipher
from app.settings.types import ProviderCredentialRecord


class LocalAuthConfigContractTests(unittest.TestCase):
    def test_local_email_signup_is_immediate_and_requires_eight_characters(
        self,
    ) -> None:
        config_path = (
            Path(__file__).resolve().parents[2] / "supabase" / "config.toml"
        )
        with config_path.open("rb") as config_file:
            config = tomllib.load(config_file)

        self.assertTrue(config["auth"]["enable_signup"])
        self.assertTrue(config["auth"]["email"]["enable_signup"])
        self.assertFalse(config["auth"]["email"]["enable_confirmations"])
        self.assertEqual(config["auth"]["minimum_password_length"], 8)


class LocalAuthSettingsIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.url = os.getenv("SUPABASE_LOCAL_TEST_URL")
        self.anon_key = os.getenv("SUPABASE_LOCAL_TEST_KEY")
        self.service_role_key = os.getenv("SUPABASE_LOCAL_SERVICE_ROLE_KEY")
        if not self.url or not self.anon_key or not self.service_role_key:
            self.skipTest(
                "SUPABASE_LOCAL_TEST_URL, SUPABASE_LOCAL_TEST_KEY, and "
                "SUPABASE_LOCAL_SERVICE_ROLE_KEY are required"
            )

        # Reject remote hosts before constructing any Supabase client.
        require_local_supabase_url(self.url)

        from supabase import create_client

        self.auth_client = create_client(self.url, self.anon_key)
        self.service_client = create_client(self.url, self.service_role_key)
        self.store = SupabaseSettingsStore(self.service_client)
        self.cipher = CredentialCipher(b"l" * 32)
        self.created_user_ids: list[str] = []

    def tearDown(self) -> None:
        if not hasattr(self, "service_client"):
            return
        for user_id in reversed(self.created_user_ids):
            self.service_client.auth.admin.delete_user(user_id)

    def _email(self, label: str) -> str:
        return f"local-{label}-{uuid4().hex}@example.test"

    def _create_user(self, label: str) -> str:
        email = self._email(label)
        password = "Local-test-password-8"
        response = self.auth_client.auth.sign_up(
            {"email": email, "password": password}
        )
        self.assertIsNotNone(response.user)
        self.assertIsNotNone(response.session)
        user_id = response.user.id
        self.created_user_ids.append(user_id)

        signed_in = self.auth_client.auth.sign_in_with_password(
            {"email": email, "password": password}
        )
        self.assertEqual(signed_in.user.id, user_id)
        return user_id

    def test_local_auth_rejects_password_shorter_than_eight_characters(self) -> None:
        from supabase_auth.errors import AuthWeakPasswordError

        with self.assertRaises(AuthWeakPasswordError):
            self.auth_client.auth.sign_up(
                {"email": self._email("short-password"), "password": "Abc1234"}
            )

    def test_two_users_have_isolated_encrypted_settings(self) -> None:
        first_user_id = self._create_user("first")
        second_user_id = self._create_user("second")
        plaintext = "test-secret-a"
        encrypted = self.cipher.encrypt(first_user_id, "openrouter", plaintext)

        self.store.upsert_credential(
            first_user_id,
            ProviderCredentialRecord(
                provider_slug="openrouter",
                encrypted=encrypted,
                connection_state="connected",
            ),
        )

        self.assertEqual(
            [
                record.encrypted.masked_suffix
                for record in self.store.list_credentials(first_user_id)
            ],
            ["et-a"],
        )
        self.assertEqual(self.store.list_credentials(second_user_id), [])
        stored = self.store.get_credential(first_user_id, "openrouter")
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertEqual(
            self.cipher.decrypt(first_user_id, "openrouter", stored.encrypted),
            plaintext,
        )

        raw = (
            self.service_client.table("provider_credentials")
            .select("ciphertext")
            .eq("user_id", first_user_id)
            .single()
            .execute()
            .data
        )
        self.assertNotIn(plaintext, raw["ciphertext"])


if __name__ == "__main__":
    unittest.main()
