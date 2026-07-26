from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import math
import secrets
from typing import Iterable, Mapping, Sequence
from uuid import uuid4

from app.projects.store import (
    GraphItemNotFound, InvalidMedia, Position, ProjectNotFound, ProjectStore,
    VersionConflict,
)
from app.projects.types import (
    CanvasAnnotation, CanvasMedia, CreationSource, EdgeType, GraphEdge, GraphNode,
    NodeRevision, NodeState, NodeType, Project, ThemeChoice,
)


MAX_MEDIA_BYTES = 5 * 1024 * 1024


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _detected_mime(content: bytes) -> str | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    return None


class ProjectService:
    def __init__(self, store: ProjectStore) -> None:
        self._store = store

    def _project(self, user_id: str, project_id: str) -> Project:
        project = self._store.get_project(user_id, project_id)
        if project is None:
            raise ProjectNotFound(project_id)
        return project

    def _node(self, user_id: str, project_id: str, node_id: str) -> GraphNode:
        node = self._store.get_node(user_id, project_id, node_id)
        if node is None:
            raise GraphItemNotFound(node_id)
        return node

    def create_project(self, user_id: str, title: str) -> Project:
        return self._store.create_project(user_id, Project.create(user_id, title))

    def list_projects(self, user_id: str, limit: int | None = None) -> tuple[Project, ...]:
        return self._store.list_projects(user_id) if limit is None else self._store.list_projects_page(user_id, limit)

    def get_graph(self, user_id: str, project_id: str) -> dict[str, object]:
        project = self._project(user_id, project_id)
        layout_version, layout, layout_dimensions = self._store.get_layout_state(user_id, project_id)
        annotation_version, annotations = self._store.get_annotations(user_id, project_id)
        project_theme = self._store.get_project_theme(user_id, project_id)
        global_theme = self._store.get_user_theme(user_id)
        return {
            "project": project,
            "nodes": self._store.list_nodes(user_id, project_id),
            "edges": self._store.list_edges(user_id, project_id),
            "layout_version": layout_version,
            "layout": layout,
            "layout_dimensions": layout_dimensions,
            "annotation_version": annotation_version,
            "annotations": annotations,
            "theme": project_theme or global_theme,
            "global_theme": global_theme,
            "project_theme": project_theme,
        }

    def create_node(self, user_id: str, project_id: str, node_type: NodeType | str,
                    title: str, content: str, created_by: CreationSource | str,
                    expected_project_version: int, provenance: str | None = None,
                    tags: Iterable[str] = ()) -> GraphNode:
        self._project(user_id, project_id)
        candidate = GraphNode.create(
            project_id, node_type, title, content, created_by,
            provenance=provenance, tags=tags,
        )
        return self._store.commit_node_creation(user_id, candidate, expected_project_version)

    def update_node(self, user_id: str, project_id: str, node_id: str, title: str,
                    content: str, expected_node_version: int,
                    expected_project_version: int | None = None) -> GraphNode:
        current = self._node(user_id, project_id, node_id)
        return self.update_node_semantics(
            user_id, project_id, node_id, node_type=current.node_type, title=title,
            content=content, state=current.state, created_by=current.created_by,
            provenance=current.provenance, tags=current.tags,
            expected_node_version=expected_node_version,
            expected_project_version=expected_project_version,
        )

    def update_node_semantics(
        self, user_id: str, project_id: str, node_id: str, *,
        node_type: NodeType | str, title: str, content: str, state: NodeState | str,
        created_by: CreationSource | str, provenance: str | None, tags: Iterable[str],
        expected_node_version: int, expected_project_version: int | None = None,
    ) -> GraphNode:
        current = self._node(user_id, project_id, node_id)
        if current.version != expected_node_version:
            raise VersionConflict(node_id)
        project = self._project(user_id, project_id)
        project_version = project.version if expected_project_version is None else expected_project_version
        validated = GraphNode.create(
            project_id, node_type, title, content, created_by,
            provenance=provenance, tags=tags,
        )
        target_type = NodeType(node_type)
        challenge_metadata = (
            current.challenge_dependencies,
            current.challenge_confidence,
            current.challenge_downstream_effect,
        ) if target_type is NodeType.CHALLENGE and current.node_type is NodeType.CHALLENGE else (
            (), None, None,
        )
        candidate = replace(
            validated, id=current.id, state=NodeState(state), version=current.version + 1,
            created_at=current.created_at, updated_at=_now(),
            challenge_dependencies=challenge_metadata[0],
            challenge_confidence=challenge_metadata[1],
            challenge_downstream_effect=challenge_metadata[2],
        )
        revision = NodeRevision.from_node(current)
        return self._store.commit_node_semantic_update(
            user_id, candidate, revision, current.version, project_version,
        )

    def connect_nodes(self, user_id: str, project_id: str, source_id: str, target_id: str,
                      edge_type: EdgeType | str, expected_project_version: int,
                      label: str | None = None) -> GraphEdge:
        self._project(user_id, project_id)
        for node_id in (source_id, target_id):
            node = self._node(user_id, project_id, node_id)
            if node.state is NodeState.TRASH:
                raise GraphItemNotFound(node_id)
        candidate = GraphEdge.create(project_id, source_id, target_id, edge_type, label=label)
        return self._store.commit_edge_creation(user_id, candidate, expected_project_version)

    def update_relationship(self, user_id: str, project_id: str, edge_id: str,
                            edge_type: EdgeType | str, label: str | None,
                            expected_edge_version: int, expected_project_version: int) -> GraphEdge:
        current = self._store.get_edge(user_id, project_id, edge_id)
        if current is None:
            raise GraphItemNotFound(edge_id)
        validated = GraphEdge.create(
            project_id, current.source_node_id, current.target_node_id, edge_type, label=label,
        )
        candidate = replace(
            validated, id=current.id, version=current.version + 1,
            created_at=current.created_at, updated_at=_now(),
        )
        return self._store.commit_edge_update(
            user_id, candidate, expected_edge_version, expected_project_version,
        )

    def delete_relationship(self, user_id: str, project_id: str, edge_id: str,
                            expected_edge_version: int, expected_project_version: int) -> None:
        self._store.commit_edge_deletion(
            user_id, project_id, edge_id, expected_edge_version, expected_project_version,
        )

    def trash_node(self, user_id: str, project_id: str, node_id: str,
                   expected_node_version: int, expected_project_version: int | None = None) -> GraphNode:
        current = self._node(user_id, project_id, node_id)
        return self.update_node_semantics(
            user_id, project_id, node_id, node_type=current.node_type,
            title=current.title, content=current.content, state=NodeState.TRASH,
            created_by=current.created_by, provenance=current.provenance, tags=current.tags,
            expected_node_version=expected_node_version,
            expected_project_version=expected_project_version,
        )

    def restore_node(self, user_id: str, project_id: str, node_id: str,
                     expected_node_version: int, expected_project_version: int | None = None) -> GraphNode:
        current = self._node(user_id, project_id, node_id)
        if current.state is not NodeState.TRASH:
            raise VersionConflict(node_id)
        return self.update_node_semantics(
            user_id, project_id, node_id, node_type=current.node_type,
            title=current.title, content=current.content, state=NodeState.WORKING,
            created_by=current.created_by, provenance=current.provenance, tags=current.tags,
            expected_node_version=expected_node_version,
            expected_project_version=expected_project_version,
        )

    def approve_decision(self, user_id: str, project_id: str, node_id: str,
                         expected_node_version: int) -> GraphNode:
        current = self._node(user_id, project_id, node_id)
        if current.node_type is not NodeType.DECISION or current.state is NodeState.TRASH:
            raise VersionConflict(node_id)
        return self.update_node_semantics(
            user_id, project_id, node_id, node_type=current.node_type,
            title=current.title, content=current.content, state=NodeState.APPROVED,
            created_by=current.created_by, provenance=current.provenance, tags=current.tags,
            expected_node_version=expected_node_version,
        )

    def save_layout(self, user_id: str, project_id: str, positions: Mapping[str, Position],
                    expected_layout_version: int, dimensions: Mapping[str, Position] | None = None) -> int:
        self._project(user_id, project_id)
        normalized: dict[str, Position] = {}
        for node_id, position in positions.items():
            self._node(user_id, project_id, node_id)
            if not isinstance(position, (tuple, list)) or len(position) != 2:
                raise ValueError("positions must contain finite x/y pairs.")
            if any(isinstance(axis, bool) or not isinstance(axis, (int, float)) for axis in position):
                raise ValueError("positions must contain finite x/y pairs.")
            point = (float(position[0]), float(position[1]))
            if not all(math.isfinite(axis) for axis in point):
                raise ValueError("positions must contain finite x/y pairs.")
            normalized[node_id] = point
        normalized_dimensions: dict[str, Position] = {}
        for node_id, size in (dimensions or {}).items():
            self._node(user_id, project_id, node_id)
            if not isinstance(size, (tuple, list)) or len(size) != 2 or any(
                isinstance(axis, bool) or not isinstance(axis, (int, float)) for axis in size
            ):
                raise ValueError("dimensions must contain finite width/height pairs.")
            value = (float(size[0]), float(size[1]))
            if not all(math.isfinite(axis) for axis in value) or not 80 <= value[0] <= 1200 or not 64 <= value[1] <= 900:
                raise ValueError("dimensions must be finite and bounded.")
            normalized_dimensions[node_id] = value
        if dimensions is None:
            normalized_dimensions = {node_id: (244.0, 124.0) for node_id in normalized}
        if dimensions is not None and set(normalized_dimensions) != set(normalized):
            raise ValueError("layout positions and dimensions must name the same nodes.")
        return self._store.save_layout(user_id, project_id, normalized, expected_layout_version, normalized_dimensions)

    def save_annotations(self, user_id: str, project_id: str,
                         annotations: Sequence[CanvasAnnotation],
                         expected_annotation_version: int) -> int:
        self._project(user_id, project_id)
        return self._store.commit_annotations(
            user_id, project_id, annotations, expected_annotation_version,
        )

    def store_media(self, user_id: str, project_id: str, filename: str,
                    declared_mime: str, content: bytes | bytearray) -> CanvasMedia:
        self._project(user_id, project_id)
        if not isinstance(filename, str) or not filename.strip():
            raise InvalidMedia("filename")
        payload = bytes(content)
        if not payload or len(payload) > MAX_MEDIA_BYTES:
            raise InvalidMedia("media size")
        detected = _detected_mime(payload)
        if detected is None or detected != declared_mime.strip().lower():
            raise InvalidMedia("media type")
        media = CanvasMedia.create(
            project_id=project_id, owner_id=user_id, storage_key=uuid4().hex,
            mime_type=detected, byte_length=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
        )
        return self._store.store_media(user_id, media, payload)

    def store_media_with_claim(self, user_id: str, project_id: str, filename: str,
                               declared_mime: str,
                               content: bytes | bytearray) -> tuple[CanvasMedia, str]:
        self._project(user_id, project_id)
        if not isinstance(filename, str) or not filename.strip():
            raise InvalidMedia("filename")
        payload = bytes(content)
        if not payload or len(payload) > MAX_MEDIA_BYTES:
            raise InvalidMedia("media size")
        detected = _detected_mime(payload)
        if detected is None or detected != declared_mime.strip().lower():
            raise InvalidMedia("media type")
        media = CanvasMedia.create(
            project_id=project_id, owner_id=user_id, storage_key=uuid4().hex,
            mime_type=detected, byte_length=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
        )
        claim = secrets.token_urlsafe(32)
        claim_hash = hashlib.sha256(claim.encode("utf-8")).hexdigest()
        return self._store.store_media_with_claim(user_id, media, payload, claim_hash), claim

    def discard_pending_media(self, user_id: str, project_id: str,
                              media_id: str, upload_claim: str) -> bool:
        claim_hash = hashlib.sha256(upload_claim.encode("utf-8")).hexdigest()
        return self._store.discard_pending_media(user_id, project_id, media_id, claim_hash)

    def read_media(self, user_id: str, project_id: str,
                   media_id: str) -> tuple[CanvasMedia, bytes] | None:
        return self._store.read_media(user_id, project_id, media_id)

    def delete_media(self, user_id: str, project_id: str, media_id: str) -> None:
        loaded = self._store.read_media(user_id, project_id, media_id)
        if loaded is None:
            raise GraphItemNotFound(media_id)
        self._store.delete_media(user_id, project_id, media_id, loaded[0].version)

    def set_user_theme(self, user_id: str, theme: ThemeChoice | str) -> None:
        self._store.set_user_theme(user_id, ThemeChoice(theme))

    def set_project_theme(self, user_id: str, project_id: str,
                          theme: ThemeChoice | str | None) -> None:
        self._project(user_id, project_id)
        self._store.set_project_theme(user_id, project_id, None if theme is None else ThemeChoice(theme))

    def list_revisions(self, user_id: str, project_id: str,
                       node_id: str) -> tuple[NodeRevision, ...]:
        self._project(user_id, project_id)
        self._node(user_id, project_id, node_id)
        return self._store.list_revisions(user_id, project_id, node_id)


__all__ = ["MAX_MEDIA_BYTES", "ProjectService"]
