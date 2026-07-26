from __future__ import annotations

from dataclasses import asdict
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import Response as BinaryResponse
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr, StringConstraints, model_validator

from app.auth.identity import UserIdentity, get_current_user
from app.composition import get_application_composition
from app.llm.types import AiConfigurationRequired, AllProvidersFailed
from app.projects.analysis import GraphAnalysisService
from app.projects.blueprint import BlueprintCompiler
from app.projects.service import MAX_MEDIA_BYTES, ProjectService
from app.projects.store import GraphItemNotFound, InvalidMedia, ProjectNotFound, StoreFailure, VersionConflict
from app.projects.types import AnnotationType, CanvasAnnotation


router = APIRouter(tags=["projects"])
MAX_ANNOTATION_PATH_POINTS = 50_000
BoundedText = Annotated[StrictStr, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
ShortText = Annotated[StrictStr, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
IdentifierText = Annotated[StrictStr, StringConstraints(
    strip_whitespace=True, min_length=36, max_length=36,
    pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
)]
TimestampText = Annotated[StrictStr, StringConstraints(
    strip_whitespace=True, min_length=20, max_length=64,
    pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}",
)]
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
    expected_layout_version: NonNegativeVersion
    positions: dict[ShortText, Annotated[list[StrictFloat | StrictInt], Field(min_length=2, max_length=2)]] = Field(max_length=2000)
    dimensions: dict[ShortText, Annotated[list[StrictFloat | StrictInt], Field(min_length=2, max_length=2)]] = Field(max_length=2000)


class AnnotationRequest(StrictModel):
    id: IdentifierText | None = None
    annotation_type: Literal["freehand", "media"]
    path_points: list[Annotated[list[StrictFloat | StrictInt], Field(min_length=2, max_length=2)]] = Field(default_factory=list, max_length=10000)
    color: Annotated[StrictStr, Field(min_length=1, max_length=64)] | None = None
    media_id: IdentifierText | None = None
    version: Annotated[StrictInt, Field(ge=1)] | None = None
    created_at: TimestampText | None = None
    updated_at: TimestampText | None = None
    project_id: IdentifierText | None = None
    owner_id: ShortText | None = None


class MediaDiscardClaim(StrictModel):
    media_id: IdentifierText
    upload_claim: Annotated[StrictStr, StringConstraints(min_length=20, max_length=200)]


class AnnotationsRequest(StrictModel):
    expected_annotation_version: NonNegativeVersion
    annotations: list[AnnotationRequest] = Field(max_length=500)
    discard_media_on_failure: list[MediaDiscardClaim] = Field(default_factory=list, max_length=500)

    @model_validator(mode="before")
    @classmethod
    def validate_aggregate_path_budget(cls, value: object) -> object:
        total = 0
        if isinstance(value, dict):
            annotations = value.get("annotations")
            if isinstance(annotations, list):
                for annotation in annotations:
                    if not isinstance(annotation, dict):
                        continue
                    points = annotation.get("path_points")
                    if isinstance(points, list):
                        total += len(points)
        if total > MAX_ANNOTATION_PATH_POINTS:
            raise ValueError("annotation path point budget exceeded")
        return value


class ThemeRequest(StrictModel):
    theme: Literal["paper", "graphite", "project"] | None


class AnalysisRequest(StrictModel):
    selected_node_id: ShortText
    analysis_type: Annotated[StrictStr, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    expected_project_version: NonNegativeVersion
    idempotency_key: Annotated[StrictStr, StringConstraints(strip_whitespace=True, min_length=8, max_length=128)]


class ProjectVersionRequest(StrictModel):
    expected_project_version: NonNegativeVersion


class ChallengeResolutionRequest(ProjectVersionRequest):
    state: Literal["resolved", "deferred", "overridden"]
    resolution: BoundedText


def get_project_service() -> ProjectService:
    return get_application_composition().project_service


def get_graph_analysis_service() -> GraphAnalysisService:
    return get_application_composition().analysis_service


def get_blueprint_compiler() -> BlueprintCompiler:
    return get_application_composition().blueprint_compiler


Service = Annotated[ProjectService, Depends(get_project_service)]
AnalysisService = Annotated[GraphAnalysisService, Depends(get_graph_analysis_service)]
BlueprintService = Annotated[BlueprintCompiler, Depends(get_blueprint_compiler)]
Identity = Annotated[UserIdentity, Depends(get_current_user)]


def _dump(value: object) -> object:
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)  # type: ignore[arg-type]
    return value


def _snapshot_dump(value: object) -> object:
    import json
    data = asdict(value)  # type: ignore[arg-type]
    payload = json.loads(data.pop("canonical_json"))
    data["sections"] = payload.get("sections", {})
    return data


def _raise_safe(exc: Exception) -> None:
    if isinstance(exc, AiConfigurationRequired):
        raise HTTPException(409, {"code": "ai_configuration_required"}) from None
    if isinstance(exc, AllProvidersFailed):
        raise HTTPException(503, {"code": "all_providers_failed"}) from None
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
def list_projects(
    service: Service, identity: Identity,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> object:
    try: return [_dump(item) for item in service.list_projects(identity.user_id, limit)]
    except Exception as exc: _raise_safe(exc)


@router.get("/summaries")
def list_project_summaries(
    service: BlueprintService, identity: Identity,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> object:
    try: return [_dump(item) for item in service.list_summaries(identity.user_id, limit)]
    except Exception as exc: _raise_safe(exc)


@router.get("/{project_id}")
def get_project(project_id: str, service: Service, identity: Identity) -> object:
    try: return service.get_graph(identity.user_id, project_id)
    except Exception as exc: _raise_safe(exc)


@router.get("/{project_id}/blueprint/readiness")
def blueprint_readiness(project_id: str, service: BlueprintService, identity: Identity) -> object:
    try: return _dump(service.readiness(identity.user_id, project_id))
    except Exception as exc: _raise_safe(exc)


@router.get("/{project_id}/summary")
def project_summary(project_id: str, service: BlueprintService, identity: Identity) -> object:
    try: return _dump(service.summary(identity.user_id, project_id))
    except Exception as exc: _raise_safe(exc)


@router.post("/{project_id}/blueprints", status_code=201)
def create_blueprint(project_id: str, body: ProjectVersionRequest,
                     service: BlueprintService, identity: Identity) -> object:
    try: return _snapshot_dump(service.compile(identity.user_id, project_id,
                                                expected_project_version=body.expected_project_version))
    except Exception as exc: _raise_safe(exc)


@router.get("/{project_id}/blueprints")
def list_blueprints(project_id: str, service: BlueprintService, identity: Identity) -> object:
    try:
        return [_snapshot_dump(item) for item in service.list_snapshots(identity.user_id, project_id)]
    except Exception as exc: _raise_safe(exc)


@router.get("/{project_id}/blueprints/{snapshot_id}")
def get_blueprint(project_id: str, snapshot_id: str,
                  service: BlueprintService, identity: Identity) -> object:
    try:
        item = service.get_snapshot(identity.user_id, project_id, snapshot_id)
        if item is None: raise GraphItemNotFound(snapshot_id)
        return _snapshot_dump(item)
    except Exception as exc: _raise_safe(exc)


@router.post("/{project_id}/analysis")
def analyze_project(project_id: str, body: AnalysisRequest, service: AnalysisService,
                    identity: Identity) -> object:
    try:
        return service.analyze(identity.user_id, project_id, body.selected_node_id,
            body.analysis_type, body.expected_project_version, body.idempotency_key)
    except Exception as exc: _raise_safe(exc)


@router.get("/{project_id}/proposals")
def list_proposals(project_id: str, service: AnalysisService, identity: Identity) -> object:
    try: return service.list_proposals(identity.user_id, project_id)
    except Exception as exc: _raise_safe(exc)


@router.post("/{project_id}/proposals/{proposal_id}/accept")
def accept_proposal(project_id: str, proposal_id: str, body: ProjectVersionRequest,
                    service: AnalysisService, identity: Identity) -> object:
    try: return service.accept(identity.user_id, project_id, proposal_id, body.expected_project_version)
    except Exception as exc: _raise_safe(exc)


@router.post("/{project_id}/challenges/{node_id}/resolve")
def resolve_challenge(project_id: str, node_id: str, body: ChallengeResolutionRequest,
                      service: AnalysisService, identity: Identity) -> object:
    try:
        return service.resolve_challenge(identity.user_id, project_id, node_id, body.state,
            body.resolution, body.expected_project_version)
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
    try: return {"version": service.save_layout(identity.user_id, project_id, body.positions, body.expected_layout_version, body.dimensions)}
    except Exception as exc: _raise_safe(exc)


@router.put("/{project_id}/annotations")
def save_annotations(project_id: str, body: AnnotationsRequest, service: Service, identity: Identity) -> object:
    request_media_ids = {
        item.media_id for item in body.annotations
        if item.annotation_type == "media" and item.media_id is not None
    }
    cleanup = {
        item.media_id: item.upload_claim for item in body.discard_media_on_failure
        if item.media_id in request_media_ids
    }
    try:
        records = []
        for item in body.annotations:
            if item.id is None:
                if item.annotation_type == "media":
                    loaded = service.read_media(identity.user_id, project_id, item.media_id or "")
                    if loaded is None: raise GraphItemNotFound(item.media_id or "")
                    record = CanvasAnnotation.create_media(project_id=project_id, owner_id=identity.user_id, media=loaded[0])
                else:
                    record = CanvasAnnotation.create(project_id=project_id, owner_id=identity.user_id,
                        annotation_type=item.annotation_type, path_points=item.path_points, color=item.color)
            else:
                record = CanvasAnnotation(id=item.id, project_id=project_id, owner_id=identity.user_id,
                    annotation_type=AnnotationType(item.annotation_type),
                    path_points=tuple((float(x), float(y)) for x, y in item.path_points),
                    color=item.color, media_id=item.media_id, version=item.version or 1,
                    created_at=item.created_at or "", updated_at=item.updated_at or "")
            records.append(record)
        return {"version": service.save_annotations(identity.user_id, project_id, records, body.expected_annotation_version)}
    except Exception as exc:
        for media_id, upload_claim in cleanup.items():
            try:
                service.discard_pending_media(identity.user_id, project_id, media_id, upload_claim)
            except Exception:
                pass
        _raise_safe(exc)


@router.post("/{project_id}/media", status_code=201)
async def upload_media(project_id: str, request: Request, service: Service, identity: Identity) -> object:
    payload = bytearray()
    async for chunk in request.stream():
        _append_bounded(payload, chunk)
    try:
        media, upload_claim = service.store_media_with_claim(identity.user_id, project_id, request.headers.get("x-filename", ""),
            request.headers.get("content-type", ""), payload)
        return {**_dump(media), "upload_claim": upload_claim}
    except InvalidMedia as exc:
        code = 413 if len(payload) > MAX_MEDIA_BYTES else 415
        raise HTTPException(code, {"code": "media_too_large" if code == 413 else "invalid_media_type"}) from None
    except Exception as exc: _raise_safe(exc)


def _append_bounded(payload: bytearray, chunk: bytes) -> None:
    if len(chunk) > MAX_MEDIA_BYTES - len(payload):
        raise HTTPException(413, {"code": "media_too_large"})
    payload.extend(chunk)


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
