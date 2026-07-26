from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import re
from typing import Iterable


class NodeType(str, Enum):
    BRAND = "brand"
    AUDIENCE = "audience"
    POSITIONING = "positioning"
    VOICE = "voice"
    VISUAL = "visual"
    CONTENT = "content"


class NodeState(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class EdgeType(str, Enum):
    SUPPORTS = "supports"
    INFORMS = "informs"
    CONTRADICTS = "contradicts"
    DERIVES_FROM = "derives_from"


class AnnotationType(str, Enum):
    FREEHAND = "freehand"
    MEDIA = "media"


class CreationSource(str, Enum):
    USER = "user"
    ANALYSIS = "analysis"
    IMPORT = "import"


class ChallengeState(str, Enum):
    OPEN = "open"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class ProposalState(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class ProjectStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class ThemeChoice(str, Enum):
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


def _text(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string.")
    return value.strip()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _enum(value: object, enum_type: type[Enum], name: str) -> None:
    if not isinstance(value, enum_type):
        raise ValueError(f"{name} must be a {enum_type.__name__} value.")


def _strings(values: Iterable[str], name: str) -> tuple[str, ...]:
    if isinstance(values, (str, bytes)):
        raise ValueError(f"{name} must be a collection of strings.")
    result = tuple(_text(value, name) for value in values)
    if len(set(result)) != len(result):
        raise ValueError(f"{name} must contain unique values.")
    return result


@dataclass(frozen=True)
class Project:
    id: str
    owner_id: str
    name: str
    status: ProjectStatus
    theme: ThemeChoice
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, id: str, owner_id: str, name: str, theme: ThemeChoice = ThemeChoice.SYSTEM) -> Project:
        _enum(theme, ThemeChoice, "theme")
        now = _now()
        return cls(_text(id, "id"), _text(owner_id, "owner_id"), _text(name, "name"), ProjectStatus.ACTIVE, theme, 1, now, now)


@dataclass(frozen=True)
class GraphNode:
    id: str
    project_id: str
    node_type: NodeType
    title: str
    content: str
    state: NodeState
    creation_source: CreationSource
    tags: tuple[str, ...]
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, id: str, project_id: str, node_type: NodeType, title: str, content: str,
               creation_source: CreationSource = CreationSource.USER, tags: Iterable[str] = ()) -> GraphNode:
        _enum(node_type, NodeType, "node_type")
        _enum(creation_source, CreationSource, "creation_source")
        now = _now()
        return cls(_text(id, "id"), _text(project_id, "project_id"), node_type, _text(title, "title"),
                   _text(content, "content"), NodeState.ACTIVE, creation_source, _strings(tags, "tags"), 1, now, now)


@dataclass(frozen=True)
class GraphEdge:
    id: str
    project_id: str
    source_node_id: str
    target_node_id: str
    edge_type: EdgeType
    label: str | None
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, id: str, project_id: str, source_node_id: str, target_node_id: str,
               edge_type: EdgeType, label: str | None = None) -> GraphEdge:
        _enum(edge_type, EdgeType, "edge_type")
        source = _text(source_node_id, "source_node_id")
        target = _text(target_node_id, "target_node_id")
        if source == target:
            raise ValueError("Graph edge cannot self-reference.")
        now = _now()
        clean_label = _text(label, "label") if label is not None else None
        return cls(_text(id, "id"), _text(project_id, "project_id"), source, target, edge_type, clean_label, 1, now, now)


@dataclass(frozen=True)
class CanvasAnnotation:
    id: str
    project_id: str
    owner_id: str
    annotation_type: AnnotationType
    path_points: tuple[tuple[float, float], ...]
    color: str | None
    media_id: str | None
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, id: str, project_id: str, owner_id: str, annotation_type: AnnotationType,
               path_points: Iterable[tuple[float, float]] = (), color: str | None = None,
               media_id: str | None = None) -> CanvasAnnotation:
        _enum(annotation_type, AnnotationType, "annotation_type")
        try:
            points = tuple((float(x), float(y)) for x, y in path_points)
        except (TypeError, ValueError) as exc:
            raise ValueError("path_points must contain numeric x/y pairs.") from exc
        if any(not math.isfinite(axis) for point in points for axis in point):
            raise ValueError("path_points must be finite.")
        clean_color = _text(color, "color") if color is not None else None
        clean_media = _text(media_id, "media_id") if media_id is not None else None
        if clean_media and (clean_media.startswith("data:") or "/" in clean_media or "://" in clean_media):
            raise ValueError("media_id must be an opaque decorative media reference.")
        if annotation_type is AnnotationType.FREEHAND:
            if len(points) < 2 or clean_media is not None:
                raise ValueError("Freehand annotations require a path and cannot reference media.")
        elif annotation_type is AnnotationType.MEDIA:
            if clean_media is None or points:
                raise ValueError("Media annotations require media_id and cannot contain a path.")
        else:
            raise ValueError("annotation_type is invalid.")
        now = _now()
        return cls(_text(id, "id"), _text(project_id, "project_id"), _text(owner_id, "owner_id"),
                   annotation_type, points, clean_color, clean_media, now, now)


@dataclass(frozen=True)
class CanvasMedia:
    id: str
    project_id: str
    owner_id: str
    storage_key: str
    mime_type: str
    byte_length: int
    sha256: str
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, id: str, project_id: str, owner_id: str, storage_key: str, mime_type: str,
               byte_length: int, sha256: str) -> CanvasMedia:
        key = _text(storage_key, "storage_key")
        if "/" in key or "\\" in key or ":" in key or key in {".", ".."}:
            raise ValueError("storage_key must be opaque, not a path or URL.")
        mime = _text(mime_type, "mime_type").lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*", mime):
            raise ValueError("mime_type must be a valid MIME type.")
        if isinstance(byte_length, bool) or not isinstance(byte_length, int) or byte_length < 1:
            raise ValueError("byte_length must be a positive integer.")
        digest = _text(sha256, "sha256").lower()
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("sha256 must be a 64-character hexadecimal digest.")
        now = _now()
        return cls(_text(id, "id"), _text(project_id, "project_id"), _text(owner_id, "owner_id"), key, mime, byte_length, digest, now, now)


@dataclass(frozen=True)
class NodeRevision:
    id: str
    project_id: str
    node_id: str
    node_version: int
    title: str
    content: str
    created_at: str

    @classmethod
    def create(cls, *, id: str, project_id: str, node_id: str, node_version: int, title: str, content: str) -> NodeRevision:
        if isinstance(node_version, bool) or not isinstance(node_version, int) or node_version < 1:
            raise ValueError("node_version must be at least 1.")
        return cls(_text(id, "id"), _text(project_id, "project_id"), _text(node_id, "node_id"), node_version,
                   _text(title, "title"), _text(content, "content"), _now())


@dataclass(frozen=True)
class AnalysisProposal:
    id: str
    project_id: str
    title: str
    rationale: str
    target_node_ids: tuple[str, ...]
    creation_source: CreationSource
    state: ProposalState
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, id: str, project_id: str, title: str, rationale: str,
               target_node_ids: Iterable[str], creation_source: CreationSource = CreationSource.ANALYSIS) -> AnalysisProposal:
        _enum(creation_source, CreationSource, "creation_source")
        targets = _strings(target_node_ids, "target_node_ids")
        if not targets:
            raise ValueError("target_node_ids must not be empty.")
        now = _now()
        return cls(_text(id, "id"), _text(project_id, "project_id"), _text(title, "title"),
                   _text(rationale, "rationale"), targets, creation_source, ProposalState.PENDING, now, now)


@dataclass(frozen=True)
class ChallengeResolution:
    id: str
    project_id: str
    challenge_id: str
    resolution: str
    state: ChallengeState
    resolved_by: str | None
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, id: str, project_id: str, challenge_id: str, resolution: str) -> ChallengeResolution:
        now = _now()
        return cls(_text(id, "id"), _text(project_id, "project_id"), _text(challenge_id, "challenge_id"),
                   _text(resolution, "resolution"), ChallengeState.OPEN, None, now, now)


@dataclass(frozen=True)
class BlueprintSnapshot:
    id: str
    project_id: str
    name: str
    node_ids: tuple[str, ...]
    edge_ids: tuple[str, ...]
    version: int
    created_at: str

    @classmethod
    def create(cls, *, id: str, project_id: str, name: str, node_ids: Iterable[str], edge_ids: Iterable[str]) -> BlueprintSnapshot:
        return cls(_text(id, "id"), _text(project_id, "project_id"), _text(name, "name"),
                   _strings(node_ids, "node_ids"), _strings(edge_ids, "edge_ids"), 1, _now())


__all__ = [
    "AnalysisProposal", "AnnotationType", "BlueprintSnapshot", "CanvasAnnotation", "CanvasMedia",
    "ChallengeResolution", "ChallengeState", "CreationSource", "EdgeType", "GraphEdge", "GraphNode",
    "NodeRevision", "NodeState", "NodeType", "Project", "ProjectStatus", "ProposalState", "ThemeChoice",
]
