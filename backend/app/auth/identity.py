from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Protocol

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

from app.config import RuntimeConfig


INVALID_CREDENTIALS_DETAIL = "Invalid authentication credentials."


@dataclass(frozen=True)
class UserIdentity:
    user_id: str
    email: str


class IdentityVerifier(Protocol):
    def verify(self, token: str) -> UserIdentity: ...


class InvalidAccessToken(RuntimeError):
    pass


class TestIdentityVerifier:
    def verify(self, token: str) -> UserIdentity:
        if token.startswith("test-user:"):
            user_id = token.removeprefix("test-user:")
            if user_id:
                return UserIdentity(
                    user_id=user_id,
                    email=f"{user_id}@example.test",
                )
        raise InvalidAccessToken("invalid or expired token")


class SupabaseIdentityVerifier:
    def __init__(self, client: Client) -> None:
        self._client = client

    def verify(self, token: str) -> UserIdentity:
        try:
            response = self._client.auth.get_user(token)
            user = response.user
        except Exception as exc:
            raise InvalidAccessToken("invalid or expired token") from exc
        if user is None or not user.id:
            raise InvalidAccessToken("invalid or expired token")
        return UserIdentity(str(user.id), user.email or "")


bearer_scheme = HTTPBearer(auto_error=False)


def _authentication_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=INVALID_CREDENTIALS_DETAIL,
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_bearer_credentials(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> HTTPAuthorizationCredentials:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _authentication_error()
    if not credentials.credentials:
        raise _authentication_error()
    return credentials


@lru_cache(maxsize=1)
def _get_identity_verifier_cached() -> IdentityVerifier:
    config = RuntimeConfig.from_env()
    if config.auth_mode == "test":
        return TestIdentityVerifier()
    if not config.supabase_anon_key:
        raise RuntimeError(
            "SUPABASE_ANON_KEY is required for Supabase authentication"
        )
    client = create_client(config.supabase_url, config.supabase_anon_key)
    return SupabaseIdentityVerifier(client)


def clear_identity_verifier_cache() -> None:
    _get_identity_verifier_cached.cache_clear()


def get_identity_verifier(
    _credentials: Annotated[
        HTTPAuthorizationCredentials,
        Depends(require_bearer_credentials),
    ],
) -> IdentityVerifier:
    return _get_identity_verifier_cached()


def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials,
        Depends(require_bearer_credentials),
    ],
    verifier: Annotated[IdentityVerifier, Depends(get_identity_verifier)],
) -> UserIdentity:
    try:
        return verifier.verify(credentials.credentials)
    except InvalidAccessToken as exc:
        raise _authentication_error() from exc
