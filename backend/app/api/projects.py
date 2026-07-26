from __future__ import annotations

from dataclasses import asdict
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import Response as BinaryResponse
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr, StringConstraints

from app.auth.identity import UserIdentity, get_current_user
from app.composition import get_application_composition
from app.projects.service import MAX_MEDIA_BYTES, ProjectService
from app.projects.store import GraphItemNotFound, InvalidMedia, ProjectNotFound, StoreFailure, VersionConflict
from app.projects.types import CanvasAnnotation


router = APIRouter(tags=["projects"])
BoundedText = Annotated[StrictStr, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
ShortText = Annotated[StrictStr, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
NonNegativeVersion = Annotated[StrictInt, Field(ge=0)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ProjectCreate(StrictModel):
    title: ShortText


class NodeCreate(StrictModel):
    node_type: Literal["evidence", "assumption", "idea", "decision", "challenge", "output"]
    title: ShortText
    content: BoundedText
    created_by: Literal["user", "hermes", "import"]
    provenance: Annotated[StrictStr, Field(max_length=500)] | None = None
    tags: list[ShortText] = Field(default_factory=list, max_length=24)
    expected_project_version: NonNegativeVersion


class NodeUpdate(NodeCreate):
    state: Literal["working", "approved", "trash"]
    expected_node_version: NonNegativeVersion


class VersionRequest(StrictModel):
    expected_node_version: NonNegativeVersion


class EdgeCreate(StrictModel):
    source_node_id: ShortText
    target_node_id: ShortText
    edge_type: Literal["supports", "contradicts", "depends_on", "inspires", "supersedes"]
    label: ShortText | None = None
    expected_project_version: NonNegativeVersion


class EdgeUpdate(StrictModel):
    edge_type: Literal["supports", "contradicts", "depends_on", "inspires", "supersedes"]
    label: ShortText | None = None
    expected_edge_version: NonNegativeVersion
    expected_project_version: NonNegativeVersion


class EdgeDelete(StrictModel):
    expected_edge_version: NonNegativeVersion
    expected_project_version: NonNegativeVersion


class LayoutRequest(StrictModel):
    positions: dict[ShortText, Annotated[list[StrictFloat | StrictInt], Field(min_length=2, max_length=2)]] = Field(max_length=2000)


class AnnotationRequest(StrictModel):
    id: StrictStr | None = None
    annotation_type: Literal["freehand", "media"]
    path_points: list[Annotated[list[StrictFloat | StrictInt], Field(min_length=2, max_length=2)]] = Field(default_factory=list, max_length=10000)
    color: Annotated[StrictStr, Field(min_length=1, max_length=64)] | None = None
    media_id: StrictStr | None = None
    version: Annotated[StrictInt, Field(ge=1)] | None = None
    created_at: StrictStr | None = None
    updated_at: StrictStr | None = None


class AnnotationsRequest(StrictModel):
    expected_annotation_version: NonNegativeVersion
    annotations: list[AnnotationRequest] = Field(max_length=500)


class ThemeRequest(StrictModel):
    theme: Literal["paper", "graphite", "project"] | None


def get_project_service() -> ProjectService:
    return get_application_composition().project_service


Service = Annotated[ProjectService, Depends(get_project_service)]
Identity = Annotated[UserIdentity, Depends(get_current_user)]


def _dump(value: object) -> object:
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)  # type: ignore[arg-type]
    return value


def _raise_safe(exc: Exception) -> None:
    if isinstance(exc, (ProjectNotFound, GraphItemNotFound)):
        raise HTTPException(404, "Project not found.") from None
    if isinstance(exc, VersionConflict):
        raise HTTPException(409, {"code": "version_conflict"}) from None
    if isinstance(exc, StoreFailure):
        raise HTTPException(503, {"code": "project_store_unavailable"}) from None
    if isinstance(exc, ValueError):
        raise HTTPException(422, {"code": "invalid_project_request"}) from None
    raise exc


@router.post("", status_code=201)
def create_project(body: ProjectCreate, service: Service, identity: Identity) -> object:
    try: return _dump(service.create_project(identity.user_id, body.title))
    except Exception as exc: _raise_safe(exc)


@router.get("")
def list_projects(service: Service, identity: Identity) -> object:
    try: return [_dump(item) for item in service.list_projects(identity.user_id)]
    except Exception as exc: _raise_safe(exc)


@router.get("/{project_id}")
def get_project(project_id: str, service: Service, identity: Identity) -> object:
    try: return service.get_graph(identity.user_id, project_id)
    except Exception as exc: _raise_safe(exc)


@router.post("/{project_id}/nodes", status_code=201)
def create_node(project_id: str, body: NodeCreate, service: Service, identity: Identity) -> object:
    try:
        return _dump(service.create_node(identity.user_id, project_id, body.node_type, body.title,
            body.content, body.created_by, body.expected_project_version, body.provenance, body.tags))
    except Exception as exc: _raise_safe(exc)


@router.patch("/{project_id}/nodes/{node_id}")
def update_node(project_id: str, node_id: str, body: NodeUpdate, service: Service, identity: Identity) -> object:
    try:
        return _dump(service.update_node_semantics(identity.user_id, project_id, node_id,
            node_type=body.node_type, title=body.title, content=body.content, state=body.state,
            created_by=body.created_by, provenance=body.provenance, tags=body.tags,
            expected_node_version=body.expected_node_version,
            expected_project_version=body.expected_project_version))
    except Exception as exc: _raise_safe(exc)


@router.post("/{project_id}/edges", status_code=201)
def create_edge(project_id: str, body: EdgeCreate, service: Service, identity: Identity) -> object:
    try:
        edge = service.connect_nodes(identity.user_id, project_id, body.source_node_id,
            body.target_node_id, body.edge_type, body.expected_project_version, body.label)
        return _dump(edge)
    except Exception as exc: _raise_safe(exc)


@router.patch("/{project_id}/edges/{edge_id}")
def update_edge(project_id: str, edge_id: str, body: EdgeUpdate, service: Service, identity: Identity) -> object:
    try: return _dump(service.update_relationship(identity.user_id, project_id, edge_id, body.edge_type,
        body.label, body.expected_edge_version, body.expected_project_version))
    except Exception as exc: _raise_safe(exc)


@router.delete("/{project_id}/edges/{edge_id}", status_code=204)
def delete_edge(project_id: str, edge_id: str, body: EdgeDelete, service: Service, identity: Identity) -> Response:
    try: service.delete_relationship(identity.user_id, project_id, edge_id, body.expected_edge_version, body.expected_project_version)
    except Exception as exc: _raise_safe(exc)
    return Response(status_code=204)


def _node_action(action: str, project_id: str, node_id: str, body: VersionRequest,
                 service: ProjectService, identity: UserIdentity) -> object:
    try: return _dump(getattr(service, action)(identity.user_id, project_id, node_id, body.expected_node_version))
    except Exception as exc: _raise_safe(exc)


@router.post("/{project_id}/nodes/{node_id}/trash")
def trash(project_id: str, node_id: str, body: VersionRequest, service: Service, identity: Identity) -> object:
    return _node_action("trash_node", project_id, node_id, body, service, identity)


@router.post("/{project_id}/nodes/{node_id}/restore")
def restore(project_id: str, node_id: str, body: VersionRequest, service: Service, identity: Identity) -> object:
    return _node_action("restore_node", project_id, node_id, body, service, identity)


@router.post("/{project_id}/nodes/{node_id}/approve")
def approve(project_id: str, node_id: str, body: VersionRequest, service: Service, identity: Identity) -> object:
    return _node_action("approve_decision", project_id, node_id, body, service, identity)


@router.put("/{project_id}/layout")
def save_layout(project_id: str, body: LayoutRequest, service: Service, identity: Identity) -> object:
    try: return {"version": service.save_layout(identity.user_id, project_id, body.positions)}
    except Exception as exc: _raise_safe(exc)


@router.put("/{project_id}/annotations")
def save_annotations(project_id: str, body: AnnotationsRequest, service: Service, identity: Identity) -> object:
    attached_media_ids: list[str] = []
    try:
        records = []
        for item in body.annotations:
            if item.id is None:
                if item.annotation_type == "media":
                    loaded = service.read_media(identity.user_id, project_id, item.media_id or "")
                    if loaded is None: raise GraphItemNotFound(item.media_id or "")
                    record = CanvasAnnotation.create_media(project_id=project_id, owner_id=identity.user_id, media=loaded[0])
                    attached_media_ids.append(loaded[0].id)
                else:
                    record = CanvasAnnotation.create(project_id=project_id, owner_id=identity.user_id,
                        annotation_type=item.annotation_type, path_points=item.path_points, color=item.color)
            else:
                record = CanvasAnnotation(id=item.id, project_id=project_id, owner_id=identity.user_id,
                    annotation_type=item.annotation_type, path_points=tuple((float(x), float(y)) for x, y in item.path_points),
                    color=item.color, media_id=item.media_id, version=item.version or 1,
                    created_at=item.created_at or "", updated_at=item.updated_at or "")
            records.append(record)
        return {"version": service.save_annotations(identity.user_id, project_id, records, body.expected_annotation_version)}
    except Exception as exc:
        for media_id in attached_media_ids:
            try:
                service.delete_media(identity.user_id, project_id, media_id)
            except Exception:
                pass
        _raise_safe(exc)


@router.post("/{project_id}/media", status_code=201)
async def upload_media(project_id: str, request: Request, service: Service, identity: Identity) -> object:
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > MAX_MEDIA_BYTES:
            raise HTTPException(413, {"code": "media_too_large"})
    try:
        media = service.store_media(identity.user_id, project_id, request.headers.get("x-filename", ""),
            request.headers.get("content-type", ""), payload)
        return _dump(media)
    except InvalidMedia as exc:
        code = 413 if len(payload) > MAX_MEDIA_BYTES else 415
        raise HTTPException(code, {"code": "media_too_large" if code == 413 else "invalid_media_type"}) from None
    except Exception as exc: _raise_safe(exc)


@router.get("/{project_id}/media/{media_id}")
def read_media(project_id: str, media_id: str, service: Service, identity: Identity) -> BinaryResponse:
    try: loaded = service.read_media(identity.user_id, project_id, media_id)
    except Exception as exc: _raise_safe(exc)
    if loaded is None: raise HTTPException(404, "Project not found.")
    return BinaryResponse(loaded[1], media_type=loaded[0].mime_type)


@router.delete("/{project_id}/media/{media_id}", status_code=204)
def delete_media(project_id: str, media_id: str, service: Service, identity: Identity) -> Response:
    try: service.delete_media(identity.user_id, project_id, media_id)
    except InvalidMedia: raise HTTPException(409, {"code": "media_in_use"}) from None
    except Exception as exc: _raise_safe(exc)
    return Response(status_code=204)


@router.put("/{project_id}/theme", status_code=204)
def project_theme(project_id: str, body: ThemeRequest, service: Service, identity: Identity) -> Response:
    try: service.set_project_theme(identity.user_id, project_id, body.theme)
    except Exception as exc: _raise_safe(exc)
    return Response(status_code=204)


@router.get("/{project_id}/revisions/{node_id}")
def revisions(project_id: str, node_id: str, service: Service, identity: Identity) -> object:
    try: return [_dump(item) for item in service.list_revisions(identity.user_id, project_id, node_id)]
    except Exception as exc: _raise_safe(exc)


users_router = APIRouter(tags=["projects"])


@users_router.put("/me/theme", status_code=204)
def user_theme(body: ThemeRequest, service: Service, identity: Identity) -> Response:
    if body.theme is None: raise HTTPException(422, {"code": "invalid_project_request"})
    try: service.set_user_theme(identity.user_id, body.theme)
    except Exception as exc: _raise_safe(exc)
    return Response(status_code=204)
