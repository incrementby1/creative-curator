import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.security import HTTPAuthorizationCredentials

from app.auth.identity import (
    clear_identity_verifier_cache,
    InvalidAccessToken,
    SupabaseIdentityVerifier,
    TestIdentityVerifier,
    UserIdentity,
    get_identity_verifier,
)


class FakeAuth:
    def __init__(self, response: object = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.received_token: str | None = None

    def get_user(self, token: str) -> object:
        self.received_token = token
        if self.error is not None:
            raise self.error
        return self.response


class IdentityVerifierTests(unittest.TestCase):
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer", credentials="placeholder"
    )

    def setUp(self) -> None:
        clear_identity_verifier_cache()

    def tearDown(self) -> None:
        clear_identity_verifier_cache()

    def test_test_verifier_accepts_nonempty_test_user_token(self) -> None:
        identity = TestIdentityVerifier().verify("test-user:user-a")

        self.assertEqual(
            identity,
            UserIdentity(user_id="user-a", email="user-a@example.test"),
        )

    def test_test_verifier_rejects_empty_or_unrecognized_token(self) -> None:
        verifier = TestIdentityVerifier()

        for token in ("", "test-user:", "user-a", "bearer:test-user:user-a"):
            with self.subTest(token=token), self.assertRaises(InvalidAccessToken):
                verifier.verify(token)

    def test_supabase_verifier_returns_typed_identity(self) -> None:
        auth = FakeAuth(
            response=SimpleNamespace(
                user=SimpleNamespace(id="supabase-user", email="user@example.test")
            )
        )
        verifier = SupabaseIdentityVerifier(SimpleNamespace(auth=auth))

        identity = verifier.verify("access-token")

        self.assertEqual(auth.received_token, "access-token")
        self.assertEqual(
            identity,
            UserIdentity(user_id="supabase-user", email="user@example.test"),
        )

    def test_supabase_verifier_maps_sdk_errors_to_invalid_access_token(self) -> None:
        verifier = SupabaseIdentityVerifier(
            SimpleNamespace(auth=FakeAuth(error=RuntimeError("upstream secret body")))
        )

        with self.assertRaisesRegex(InvalidAccessToken, "invalid or expired token"):
            verifier.verify("sensitive-token")

    def test_supabase_verifier_rejects_missing_user_or_id(self) -> None:
        for user in (None, SimpleNamespace(id="", email="nobody@example.test")):
            with self.subTest(user=user):
                verifier = SupabaseIdentityVerifier(
                    SimpleNamespace(auth=FakeAuth(response=SimpleNamespace(user=user)))
                )
                with self.assertRaisesRegex(
                    InvalidAccessToken, "invalid or expired token"
                ):
                    verifier.verify("access-token")

    def test_supabase_verifier_allows_missing_email(self) -> None:
        verifier = SupabaseIdentityVerifier(
            SimpleNamespace(
                auth=FakeAuth(
                    response=SimpleNamespace(
                        user=SimpleNamespace(id="supabase-user", email=None)
                    )
                )
            )
        )

        self.assertEqual(verifier.verify("access-token").email, "")

    def test_factory_selects_guarded_test_verifier(self) -> None:
        env = {
            "APP_ENV": "development",
            "AUTH_MODE": "test",
            "SETTINGS_STORE_MODE": "memory",
            "LLM_TRANSPORT_MODE": "test",
        }
        with patch.dict(os.environ, env, clear=True):
            verifier = get_identity_verifier(self.credentials)

        self.assertIsInstance(verifier, TestIdentityVerifier)

    def test_factory_rejects_test_auth_in_production(self) -> None:
        env = {
            "APP_ENV": "production",
            "AUTH_MODE": "test",
            "SETTINGS_STORE_MODE": "memory",
            "LLM_TRANSPORT_MODE": "live",
        }
        with patch.dict(os.environ, env, clear=True), self.assertRaisesRegex(
            RuntimeError, "test mode is not allowed in production"
        ):
            get_identity_verifier(self.credentials)

    def test_factory_reuses_supabase_verifier_and_client(self) -> None:
        env = {
            "APP_ENV": "development",
            "AUTH_MODE": "supabase",
            "SETTINGS_STORE_MODE": "memory",
            "LLM_TRANSPORT_MODE": "live",
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "SUPABASE_ANON_KEY": "local-anon",
        }
        client = SimpleNamespace(auth=FakeAuth())

        with patch.dict(os.environ, env, clear=True), patch(
            "app.auth.identity.create_client", return_value=client
        ) as create_client:
            first = get_identity_verifier(self.credentials)
            second = get_identity_verifier(self.credentials)

        self.assertIs(first, second)
        create_client.assert_called_once_with(
            "http://127.0.0.1:54321", "local-anon"
        )


if __name__ == "__main__":
    unittest.main()
