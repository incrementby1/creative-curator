import base64
import os
import unittest
from unittest.mock import patch

from app.config import RuntimeConfig


class RuntimeConfigTests(unittest.TestCase):
    def test_repr_redacts_all_secret_fields(self) -> None:
        config = RuntimeConfig(
            app_env="development",
            auth_mode="test",
            settings_store_mode="memory",
            llm_transport_mode="test",
            supabase_url="http://localhost:54321",
            supabase_anon_key="sentinel-anon-secret",
            supabase_service_role_key="sentinel-role-secret",
            master_key=b"sentinel-master-secret",
        )

        rendered = repr(config)

        self.assertNotIn("sentinel-anon-secret", rendered)
        self.assertNotIn("sentinel-role-secret", rendered)
        self.assertNotIn("sentinel-master-secret", rendered)

    def test_persistent_mode_requires_local_supabase_and_master_key(self) -> None:
        key = base64.b64encode(b"k" * 32).decode()
        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "SUPABASE_SERVICE_ROLE_KEY": "local-role",
            "SUPABASE_ANON_KEY": "local-anon",
            "BYOK_MASTER_KEY": key,
        }, clear=True):
            config = RuntimeConfig.from_env()
        self.assertEqual(config.master_key, b"k" * 32)
        self.assertEqual(config.auth_mode, "supabase")

    def test_remote_supabase_is_rejected(self) -> None:
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "remote-role",
            "BYOK_MASTER_KEY": base64.b64encode(b"k" * 32).decode(),
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "localhost or 127.0.0.1"):
                RuntimeConfig.from_env()

    def test_test_mode_is_rejected_in_production(self) -> None:
        with patch.dict(os.environ, {"AUTH_MODE": "test", "APP_ENV": "production"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "test mode"):
                RuntimeConfig.from_env()

    def test_test_transport_is_rejected_in_production(self) -> None:
        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "LLM_TRANSPORT_MODE": "test",
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "test mode"):
                RuntimeConfig.from_env()

    def test_malformed_master_key_fails_closed(self) -> None:
        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://localhost:54321",
            "SUPABASE_SERVICE_ROLE_KEY": "local-role",
            "BYOK_MASTER_KEY": "not-base64!",
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "BYOK_MASTER_KEY"):
                RuntimeConfig.from_env()

    def test_memory_mode_rejects_supplied_malformed_master_key(self) -> None:
        with patch.dict(os.environ, {
            "AUTH_MODE": "test",
            "SETTINGS_STORE_MODE": "memory",
            "BYOK_MASTER_KEY": "not-base64!",
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "BYOK_MASTER_KEY"):
                RuntimeConfig.from_env()

    def test_wrong_length_master_key_fails_closed(self) -> None:
        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://localhost:54321",
            "BYOK_MASTER_KEY": base64.b64encode(b"short").decode(),
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "exactly 32 bytes"):
                RuntimeConfig.from_env()

    def test_invalid_modes_fail_closed(self) -> None:
        variables = ("AUTH_MODE", "SETTINGS_STORE_MODE", "LLM_TRANSPORT_MODE")
        for variable in variables:
            with self.subTest(variable=variable):
                with patch.dict(os.environ, {variable: "invalid"}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, variable):
                        RuntimeConfig.from_env()
