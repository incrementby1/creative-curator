from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import re
from typing import Iterable
from uuid import uuid4


class NodeType(str, Enum):
    EVIDENCE = "evidence"
    ASSUMPTION = "assumption"
    IDEA = "idea"
    DECISION = "decision"
    CHALLENGE = "challenge"
    OUTPUT = "output"


class NodeState(str, Enum):
    WORKING = "working"
    APPROVED = "approved"
    TRASH = "trash"


class EdgeType(str, Enum):
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    DEPENDS_ON = "depends_on"
    INSPIRES = "inspires"
    SUPERSEDES = "supersedes"


class AnnotationType(str, Enum):
    FREEHAND = "freehand"
    MEDIA = "media"


class CreationSource(str, Enum):
    USER = "user"
    HERMES = "hermes"
    IMPORT = "import"


class ChallengeState(str, Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    DEFERRED = "deferred"
    OVERRIDDEN = "overridden"


class ProposalState(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class ProjectStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class ThemeChoice(str, Enum):
    PAPER = "paper"
    GRAPHITE = "graphite"
    PROJECT = "project"


def _text(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string.")
    return value.strip()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _enum(value: object, enum_type: type[Enum], name: str) -> Enum:
    if isinstance(value, enum_type):
        return value
    if isinstance(value, str):
        try:
            return enum_type(value.strip())
        except ValueError as exc:
            raise ValueError(f"{name} is invalid.") from exc
    raise ValueError(f"{name} must be a string or {enum_type.__name__} value.")


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
    title: str
    status: ProjectStatus
    theme: ThemeChoice
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, owner_id: str, title: str, theme: ThemeChoice | str = ThemeChoice.PAPER) -> Project:
        clean_theme = _enum(theme, ThemeChoice, "theme")
        now = _now()
        return cls(str(uuid4()), _text(owner_id, "owner_id"), _text(title, "title"), ProjectStatus.ACTIVE,
                   clean_theme, 1, now, now)  # type: ignore[arg-type]


@dataclass(frozen=True)
class GraphNode:
    id: str
    project_id: str
    node_type: NodeType
    title: str
    content: str
    state: NodeState
    created_by: CreationSource
    provenance: str | None
    tags: tuple[str, ...]
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, project_id: str, node_type: NodeType | str, title: str, content: str,
               created_by: CreationSource | str, *, provenance: str | None = None,
               tags: Iterable[str] = ()) -> GraphNode:
        clean_type = _enum(node_type, NodeType, "node_type")
        clean_creator = _enum(created_by, CreationSource, "created_by")
        if provenance is None:
            clean_provenance = None
        elif not isinstance(provenance, str):
            raise ValueError("provenance must be a string or None.")
        else:
            clean_provenance = provenance.strip() or None
        now = _now()
        return cls(str(uuid4()), _text(project_id, "project_id"), clean_type, _text(title, "title"),
                   _text(content, "content"), NodeState.WORKING, clean_creator, clean_provenance,
                   _strings(tags, "tags"), 1, now, now)  # type: ignore[arg-type]


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
    def create(cls, project_id: str, source_node_id: str, target_node_id: str, edge_type: EdgeType | str,
               *, label: str | None = None) -> GraphEdge:
        clean_type = _enum(edge_type, EdgeType, "edge_type")
        source = _text(source_node_id, "source_node_id")
        target = _text(target_node_id, "target_node_id")
        if source == target:
            raise ValueError("Graph edge cannot self-reference.")
        now = _now()
        clean_label = _text(label, "label") if label is not None else None
        return cls(str(uuid4()), _text(project_id, "project_id"), source, target, clean_type,
                   clean_label, 1, now, now)  # type: ignore[arg-type]


@dataclass(frozen=True)
class CanvasAnnotation:
    id: str
    project_id: str
    owner_id: str
    annotation_type: AnnotationType
    path_points: tuple[tuple[float, float], ...]
    color: str | None
    media_id: str | None
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, project_id: str, owner_id: str, annotation_type: AnnotationType,
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
        if annotation_type is AnnotationType.FREEHAND:
            if len(points) < 2 or clean_media is not None:
                raise ValueError("Freehand annotations require a path and cannot reference media.")
        elif annotation_type is AnnotationType.MEDIA:
            raise ValueError("Media annotations must be created with create_media().")
        else:
            raise ValueError("annotation_type is invalid.")
        now = _now()
        return cls(str(uuid4()), _text(project_id, "project_id"), _text(owner_id, "owner_id"),
                   annotation_type, points, clean_color, clean_media, 1, now, now)

    @classmethod
    def create_media(cls, *, project_id: str, owner_id: str, media: CanvasMedia) -> CanvasAnnotation:
        clean_project = _text(project_id, "project_id")
        clean_owner = _text(owner_id, "owner_id")
        if not isinstance(media, CanvasMedia):
            raise ValueError("media must be a CanvasMedia record.")
        if media.project_id != clean_project or media.owner_id != clean_owner:
            raise ValueError("Media and annotation must have matching project and owner scope.")
        now = _now()
        return cls(str(uuid4()), clean_project, clean_owner, AnnotationType.MEDIA, (), None,
                   media.id, 1, now, now)


@dataclass(frozen=True)
class CanvasMedia:
    id: str
    project_id: str
    owner_id: str
    storage_key: str
    mime_type: str
    byte_length: int
    sha256: str
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, project_id: str, owner_id: str, storage_key: str, mime_type: str,
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
        return cls(str(uuid4()), _text(project_id, "project_id"), _text(owner_id, "owner_id"),
                   key, mime, byte_length, digest, 1, now, now)


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
    def create(cls, *, project_id: str, node_id: str, node_version: int, title: str, content: str) -> NodeRevision:
        if isinstance(node_version, bool) or not isinstance(node_version, int) or node_version < 1:
            raise ValueError("node_version must be at least 1.")
        return cls(str(uuid4()), _text(project_id, "project_id"), _text(node_id, "node_id"), node_version,
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
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, project_id: str, title: str, rationale: str,
               target_node_ids: Iterable[str], creation_source: CreationSource | str = CreationSource.HERMES) -> AnalysisProposal:
        clean_source = _enum(creation_source, CreationSource, "creation_source")
        targets = _strings(target_node_ids, "target_node_ids")
        if not targets:
            raise ValueError("target_node_ids must not be empty.")
        now = _now()
        return cls(str(uuid4()), _text(project_id, "project_id"), _text(title, "title"),
                   _text(rationale, "rationale"), targets, clean_source, ProposalState.PENDING, 1,
                   now, now)  # type: ignore[arg-type]


@dataclass(frozen=True)
class ChallengeResolution:
    id: str
    project_id: str
    challenge_id: str
    resolution: str
    state: ChallengeState
    resolved_by: str | None
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, *, project_id: str, challenge_id: str, resolution: str) -> ChallengeResolution:
        now = _now()
        return cls(str(uuid4()), _text(project_id, "project_id"), _text(challenge_id, "challenge_id"),
                   _text(resolution, "resolution"), ChallengeState.OPEN, None, 1, now, now)


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
    def create(cls, *, project_id: str, name: str, node_ids: Iterable[str], edge_ids: Iterable[str]) -> BlueprintSnapshot:
        return cls(str(uuid4()), _text(project_id, "project_id"), _text(name, "name"),
                   _strings(node_ids, "node_ids"), _strings(edge_ids, "edge_ids"), 1, _now())


__all__ = [
    "AnalysisProposal", "AnnotationType", "BlueprintSnapshot", "CanvasAnnotation", "CanvasMedia",
    "ChallengeResolution", "ChallengeState", "CreationSource", "EdgeType", "GraphEdge", "GraphNode",
    "NodeRevision", "NodeState", "NodeType", "Project", "ProjectStatus", "ProposalState", "ThemeChoice",
]
