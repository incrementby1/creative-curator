from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, StringConstraints

from app.auth.identity import UserIdentity, get_current_user
from app.composition import (
    clear_application_composition_cache,
    get_application_composition,
)
from app.settings.service import (
    InvalidProviderConfiguration,
    ProviderConnectionFailed,
    ProviderInUse,
    ProviderNotConnected,
    ProviderUnknown,
    SettingsService,
)
from app.settings.types import RouteTarget, SettingsVersionConflict


router = APIRouter(tags=["settings"])

ApiKey = Annotated[str, StringConstraints(min_length=1, max_length=4096)]
ModelName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)
]
Endpoint = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2048)
]
ProviderSlug = Annotated[
    str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
]


class ProviderAccessRequest(BaseModel):
    api_key: ApiKey | None = None
    base_url: Endpoint | None = None


class TestProviderRequest(ProviderAccessRequest):
    model: ModelName


class SaveProviderRequest(BaseModel):
    api_key: ApiKey
    model: ModelName
    base_url: Endpoint | None = None


class RouteTargetModel(BaseModel):
    provider_slug: ProviderSlug
    model: ModelName


class SaveRoutingRequest(BaseModel):
    primary: RouteTargetModel | None
    fallbacks: list[RouteTargetModel] = Field(default_factory=list, max_length=5)
    version: int = Field(ge=1)


def get_settings_service() -> SettingsService:
    return get_application_composition().settings_service


def clear_settings_service_cache() -> None:
    clear_application_composition_cache()


IdentityDependency = Annotated[UserIdentity, Depends(get_current_user)]
ServiceDependency = Annotated[SettingsService, Depends(get_settings_service)]


@router.get("/providers")
def list_providers(
    identity: IdentityDependency,
    service: ServiceDependency,
) -> dict:
    return service.provider_catalog(identity.user_id)


@router.post("/providers/{provider_slug}/test")
def test_provider(
    provider_slug: ProviderSlug,
    request: TestProviderRequest,
    identity: IdentityDependency,
    service: ServiceDependency,
) -> dict[str, bool]:
    try:
        service.test_connection(
            identity.user_id,
            provider_slug,
            request.api_key,
            request.model,
            request.base_url,
        )
    except Exception as exc:
        _raise_api_error(exc)
    return {"ok": True}


@router.post("/providers/{provider_slug}/models")
def discover_provider_models(
    provider_slug: ProviderSlug,
    request: ProviderAccessRequest,
    identity: IdentityDependency,
    service: ServiceDependency,
) -> dict:
    try:
        return service.discover_models(
            identity.user_id,
            provider_slug,
            request.api_key,
            request.base_url,
        )
    except Exception as exc:
        _raise_api_error(exc)


@router.put("/providers/{provider_slug}")
def save_provider(
    provider_slug: ProviderSlug,
    request: SaveProviderRequest,
    identity: IdentityDependency,
    service: ServiceDependency,
) -> dict:
    try:
        return service.save_provider(
            identity.user_id,
            provider_slug,
            request.api_key,
            request.model,
            request.base_url,
        )
    except Exception as exc:
        _raise_api_error(exc)


@router.delete("/providers/{provider_slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider(
    provider_slug: ProviderSlug,
    identity: IdentityDependency,
    service: ServiceDependency,
) -> Response:
    try:
        service.delete_provider(identity.user_id, provider_slug)
    except Exception as exc:
        _raise_api_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/routing")
def get_routing(
    identity: IdentityDependency,
    service: ServiceDependency,
) -> dict:
    return service.get_routing(identity.user_id)


@router.put("/routing")
def save_routing(
    request: SaveRoutingRequest,
    identity: IdentityDependency,
    service: ServiceDependency,
) -> dict:
    primary = (
        RouteTarget(request.primary.provider_slug, request.primary.model)
        if request.primary is not None
        else None
    )
    fallbacks = tuple(
        RouteTarget(item.provider_slug, item.model) for item in request.fallbacks
    )
    try:
        return service.save_routing(
            identity.user_id, primary, fallbacks, request.version
        )
    except Exception as exc:
        _raise_api_error(exc)


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, ProviderUnknown):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code},
        ) from None
    if isinstance(exc, SettingsVersionConflict):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "settings_version_conflict"},
        ) from None
    if isinstance(exc, ProviderInUse):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code},
        ) from None
    if isinstance(exc, ProviderConnectionFailed):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "category": exc.category},
        ) from None
    if isinstance(
        exc, (ProviderNotConnected, InvalidProviderConfiguration, ValueError)
    ):
        code = getattr(exc, "code", "invalid_settings")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": code},
        ) from None
    raise exc
