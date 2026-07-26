from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timezone
from threading import RLock
from typing import Any, Mapping, Protocol, Sequence

from app.projects.types import (
    AnalysisProposal,
    BlueprintSnapshot,
    CanvasAnnotation,
    CanvasMedia,
    GraphEdge,
    GraphNode,
    NodeRevision,
    Project,
    ProposalState,
    ThemeChoice,
)


class StoreFailure(RuntimeError):
    """Base error for safe project persistence failures."""


class ProjectNotFound(StoreFailure):
    pass


class GraphItemNotFound(StoreFailure):
    pass


class VersionConflict(StoreFailure):
    pass


class InvalidMedia(StoreFailure):
    pass


Position = tuple[float, float]
Analysis = dict[str, Any]


class ProjectStore(Protocol):
    def create_project(self, user_id: str, project: Project) -> Project: ...
    def get_project(self, user_id: str, project_id: str) -> Project | None: ...
    def list_projects(self, user_id: str) -> tuple[Project, ...]: ...
    def update_project(self, user_id: str, project: Project, expected_version: int) -> Project: ...

    def create_node(self, user_id: str, node: GraphNode) -> GraphNode: ...
    def get_node(self, user_id: str, project_id: str, node_id: str) -> GraphNode | None: ...
    def list_nodes(self, user_id: str, project_id: str) -> tuple[GraphNode, ...]: ...
    def update_node(self, user_id: str, node: GraphNode, expected_version: int) -> GraphNode: ...
    def delete_node(self, user_id: str, project_id: str, node_id: str, expected_version: int) -> None: ...
    def commit_node_semantic_update(
        self, user_id: str, node: GraphNode, revision: NodeRevision,
        expected_node_version: int, expected_project_version: int,
    ) -> GraphNode: ...

    def create_edge(self, user_id: str, edge: GraphEdge) -> GraphEdge: ...
    def get_edge(self, user_id: str, project_id: str, edge_id: str) -> GraphEdge | None: ...
    def list_edges(self, user_id: str, project_id: str) -> tuple[GraphEdge, ...]: ...
    def update_edge(self, user_id: str, edge: GraphEdge, expected_version: int) -> GraphEdge: ...
    def delete_edge(self, user_id: str, project_id: str, edge_id: str, expected_version: int) -> None: ...

    def append_revision(self, user_id: str, revision: NodeRevision) -> NodeRevision: ...
    def list_revisions(self, user_id: str, project_id: str, node_id: str) -> tuple[NodeRevision, ...]: ...

    def create_proposal(self, user_id: str, proposal: AnalysisProposal) -> AnalysisProposal: ...
    def get_proposal(self, user_id: str, project_id: str, proposal_id: str) -> AnalysisProposal | None: ...
    def list_proposals(self, user_id: str, project_id: str) -> tuple[AnalysisProposal, ...]: ...
    def update_proposal(self, user_id: str, proposal: AnalysisProposal, expected_version: int) -> AnalysisProposal: ...
    def commit_proposal_acceptance(
        self, user_id: str, proposal: AnalysisProposal,
        nodes: Sequence[GraphNode], edges: Sequence[GraphEdge],
        expected_proposal_version: int, expected_project_version: int,
    ) -> AnalysisProposal: ...

    def put_analysis(self, user_id: str, project_id: str, cache_key: str, analysis: Mapping[str, Any]) -> None: ...
    def get_analysis(self, user_id: str, project_id: str, cache_key: str) -> Analysis | None: ...
    def list_analyses(self, user_id: str, project_id: str) -> tuple[tuple[str, Analysis], ...]: ...
    def delete_analysis(self, user_id: str, project_id: str, cache_key: str) -> None: ...

    def create_snapshot(self, user_id: str, snapshot: BlueprintSnapshot) -> BlueprintSnapshot: ...
    def list_snapshots(self, user_id: str, project_id: str) -> tuple[BlueprintSnapshot, ...]: ...
    def get_snapshot(self, user_id: str, project_id: str, snapshot_id: str) -> BlueprintSnapshot | None: ...

    def save_layout(self, user_id: str, project_id: str, positions: Mapping[str, Position], expected_version: int) -> int: ...
    def get_layout(self, user_id: str, project_id: str) -> tuple[int, dict[str, Position]]: ...
    def save_annotations(
        self, user_id: str, project_id: str, annotations: Sequence[CanvasAnnotation], expected_version: int,
    ) -> int: ...
    def get_annotations(self, user_id: str, project_id: str) -> tuple[int, tuple[CanvasAnnotation, ...]]: ...

    def store_media(self, user_id: str, media: CanvasMedia, content: bytes | bytearray) -> CanvasMedia: ...
    def read_media(self, user_id: str, project_id: str, media_id: str) -> tuple[CanvasMedia, bytes] | None: ...
    def delete_media(self, user_id: str, project_id: str, media_id: str, expected_version: int) -> None: ...

    def set_user_theme(self, user_id: str, theme: ThemeChoice) -> None: ...
    def get_user_theme(self, user_id: str) -> ThemeChoice: ...
    def set_project_theme(self, user_id: str, project_id: str, theme: ThemeChoice | None) -> None: ...
    def get_project_theme(self, user_id: str, project_id: str) -> ThemeChoice | None: ...


class InMemoryProjectStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self._projects: dict[tuple[str, str], Project] = {}
        self._nodes: dict[tuple[str, str, str], GraphNode] = {}
        self._edges: dict[tuple[str, str, str], GraphEdge] = {}
        self._revisions: dict[tuple[str, str, str], list[NodeRevision]] = {}
        self._proposals: dict[tuple[str, str, str], AnalysisProposal] = {}
        self._analyses: dict[tuple[str, str, str], Analysis] = {}
        self._snapshots: dict[tuple[str, str, str], BlueprintSnapshot] = {}
        self._layouts: dict[tuple[str, str], tuple[int, dict[str, Position]]] = {}
        self._annotations: dict[tuple[str, str], tuple[int, tuple[CanvasAnnotation, ...]]] = {}
        self._media: dict[tuple[str, str, str], tuple[CanvasMedia, bytes]] = {}
        self._user_themes: dict[str, ThemeChoice] = {}
        self._project_themes: dict[tuple[str, str], ThemeChoice] = {}

    @staticmethod
    def _copy(value: Any) -> Any:
        return deepcopy(value)

    def _owned_project(self, user_id: str, project_id: str) -> Project:
        project = self._projects.get((user_id, project_id))
        if project is None:
            raise ProjectNotFound(project_id)
        return project

    @staticmethod
    def _check_scope(project_id: str, actual_project_id: str) -> None:
        if project_id != actual_project_id:
            raise GraphItemNotFound(actual_project_id)

    @staticmethod
    def _check_cas(actual: int, expected: int, item_id: str) -> None:
        if actual != expected:
            raise VersionConflict(item_id)

    @staticmethod
    def _check_candidate_version(candidate: int, expected: int, item_id: str) -> None:
        if candidate != expected + 1:
            raise VersionConflict(item_id)

    def create_project(self, user_id: str, project: Project) -> Project:
        with self._lock:
            if project.owner_id != user_id:
                raise ProjectNotFound(project.id)
            key = (user_id, project.id)
            if key in self._projects:
                raise VersionConflict(project.id)
            self._projects[key] = self._copy(project)
            return self._copy(project)

    def get_project(self, user_id: str, project_id: str) -> Project | None:
        with self._lock:
            project = self._projects.get((user_id, project_id))
            return self._copy(project) if project is not None else None

    def list_projects(self, user_id: str) -> tuple[Project, ...]:
        with self._lock:
            return tuple(self._copy(self._projects[key]) for key in sorted(self._projects) if key[0] == user_id)

    def update_project(self, user_id: str, project: Project, expected_version: int) -> Project:
        with self._lock:
            current = self._owned_project(user_id, project.id)
            if project.owner_id != user_id:
                raise ProjectNotFound(project.id)
            self._check_cas(current.version, expected_version, project.id)
            self._check_candidate_version(project.version, expected_version, project.id)
            self._projects[(user_id, project.id)] = self._copy(project)
            return self._copy(project)

    def create_node(self, user_id: str, node: GraphNode) -> GraphNode:
        with self._lock:
            self._owned_project(user_id, node.project_id)
            key = (user_id, node.project_id, node.id)
            if key in self._nodes:
                raise VersionConflict(node.id)
            self._nodes[key] = self._copy(node)
            return self._copy(node)

    def get_node(self, user_id: str, project_id: str, node_id: str) -> GraphNode | None:
        with self._lock:
            node = self._nodes.get((user_id, project_id, node_id))
            return self._copy(node) if node is not None else None

    def list_nodes(self, user_id: str, project_id: str) -> tuple[GraphNode, ...]:
        with self._lock:
            prefix = (user_id, project_id)
            return tuple(self._copy(self._nodes[key]) for key in sorted(self._nodes) if key[:2] == prefix)

    def update_node(self, user_id: str, node: GraphNode, expected_version: int) -> GraphNode:
        with self._lock:
            self._owned_project(user_id, node.project_id)
            key = (user_id, node.project_id, node.id)
            current = self._nodes.get(key)
            if current is None:
                raise GraphItemNotFound(node.id)
            self._check_cas(current.version, expected_version, node.id)
            self._check_candidate_version(node.version, expected_version, node.id)
            self._nodes[key] = self._copy(node)
            return self._copy(node)

    def delete_node(self, user_id: str, project_id: str, node_id: str, expected_version: int) -> None:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id, node_id)
            current = self._nodes.get(key)
            if current is None:
                raise GraphItemNotFound(node_id)
            self._check_cas(current.version, expected_version, node_id)
            del self._nodes[key]

    def commit_node_semantic_update(
        self, user_id: str, node: GraphNode, revision: NodeRevision,
        expected_node_version: int, expected_project_version: int,
    ) -> GraphNode:
        with self._lock:
            project = self._owned_project(user_id, node.project_id)
            key = (user_id, node.project_id, node.id)
            current = self._nodes.get(key)
            if current is None:
                raise GraphItemNotFound(node.id)
            self._check_cas(current.version, expected_node_version, node.id)
            self._check_cas(project.version, expected_project_version, project.id)
            self._check_candidate_version(node.version, expected_node_version, node.id)
            if revision.project_id != node.project_id or revision.node_id != node.id:
                raise GraphItemNotFound(revision.node_id)
            if (revision.node_version, revision.title, revision.content) != (current.version, current.title, current.content):
                raise VersionConflict(node.id)

            now = datetime.now(timezone.utc).isoformat()
            updated_project = replace(project, version=project.version + 1, updated_at=now)
            self._revisions.setdefault(key, []).append(self._copy(revision))
            self._nodes[key] = self._copy(node)
            self._projects[(user_id, project.id)] = updated_project
            return self._copy(node)

    def create_edge(self, user_id: str, edge: GraphEdge) -> GraphEdge:
        with self._lock:
            self._owned_project(user_id, edge.project_id)
            key = (user_id, edge.project_id, edge.id)
            if key in self._edges:
                raise VersionConflict(edge.id)
            self._edges[key] = self._copy(edge)
            return self._copy(edge)

    def get_edge(self, user_id: str, project_id: str, edge_id: str) -> GraphEdge | None:
        with self._lock:
            edge = self._edges.get((user_id, project_id, edge_id))
            return self._copy(edge) if edge is not None else None

    def list_edges(self, user_id: str, project_id: str) -> tuple[GraphEdge, ...]:
        with self._lock:
            prefix = (user_id, project_id)
            return tuple(self._copy(self._edges[key]) for key in sorted(self._edges) if key[:2] == prefix)

    def update_edge(self, user_id: str, edge: GraphEdge, expected_version: int) -> GraphEdge:
        with self._lock:
            self._owned_project(user_id, edge.project_id)
            key = (user_id, edge.project_id, edge.id)
            current = self._edges.get(key)
            if current is None:
                raise GraphItemNotFound(edge.id)
            self._check_cas(current.version, expected_version, edge.id)
            self._check_candidate_version(edge.version, expected_version, edge.id)
            self._edges[key] = self._copy(edge)
            return self._copy(edge)

    def delete_edge(self, user_id: str, project_id: str, edge_id: str, expected_version: int) -> None:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id, edge_id)
            current = self._edges.get(key)
            if current is None:
                raise GraphItemNotFound(edge_id)
            self._check_cas(current.version, expected_version, edge_id)
            del self._edges[key]

    def append_revision(self, user_id: str, revision: NodeRevision) -> NodeRevision:
        with self._lock:
            self._owned_project(user_id, revision.project_id)
            if (user_id, revision.project_id, revision.node_id) not in self._nodes:
                raise GraphItemNotFound(revision.node_id)
            self._revisions.setdefault((user_id, revision.project_id, revision.node_id), []).append(self._copy(revision))
            return self._copy(revision)

    def list_revisions(self, user_id: str, project_id: str, node_id: str) -> tuple[NodeRevision, ...]:
        with self._lock:
            items = self._revisions.get((user_id, project_id, node_id), [])
            return tuple(self._copy(item) for item in sorted(items, key=lambda item: (item.node_version, item.id)))

    def create_proposal(self, user_id: str, proposal: AnalysisProposal) -> AnalysisProposal:
        with self._lock:
            self._owned_project(user_id, proposal.project_id)
            key = (user_id, proposal.project_id, proposal.id)
            if key in self._proposals:
                raise VersionConflict(proposal.id)
            self._proposals[key] = self._copy(proposal)
            return self._copy(proposal)

    def get_proposal(self, user_id: str, project_id: str, proposal_id: str) -> AnalysisProposal | None:
        with self._lock:
            item = self._proposals.get((user_id, project_id, proposal_id))
            return self._copy(item) if item is not None else None

    def list_proposals(self, user_id: str, project_id: str) -> tuple[AnalysisProposal, ...]:
        with self._lock:
            prefix = (user_id, project_id)
            return tuple(self._copy(self._proposals[key]) for key in sorted(self._proposals) if key[:2] == prefix)

    def update_proposal(self, user_id: str, proposal: AnalysisProposal, expected_version: int) -> AnalysisProposal:
        with self._lock:
            self._owned_project(user_id, proposal.project_id)
            key = (user_id, proposal.project_id, proposal.id)
            current = self._proposals.get(key)
            if current is None:
                raise GraphItemNotFound(proposal.id)
            self._check_cas(current.version, expected_version, proposal.id)
            self._check_candidate_version(proposal.version, expected_version, proposal.id)
            self._proposals[key] = self._copy(proposal)
            return self._copy(proposal)

    def commit_proposal_acceptance(
        self, user_id: str, proposal: AnalysisProposal,
        nodes: Sequence[GraphNode], edges: Sequence[GraphEdge],
        expected_proposal_version: int, expected_project_version: int,
    ) -> AnalysisProposal:
        with self._lock:
            project = self._owned_project(user_id, proposal.project_id)
            key = (user_id, proposal.project_id, proposal.id)
            current = self._proposals.get(key)
            if current is None:
                raise GraphItemNotFound(proposal.id)
            self._check_cas(current.version, expected_proposal_version, proposal.id)
            self._check_cas(project.version, expected_project_version, project.id)
            self._check_candidate_version(proposal.version, expected_proposal_version, proposal.id)
            if proposal.state is not ProposalState.ACCEPTED:
                raise VersionConflict(proposal.id)
            for item in (*nodes, *edges):
                self._check_scope(proposal.project_id, item.project_id)
            node_keys = [(user_id, proposal.project_id, item.id) for item in nodes]
            edge_keys = [(user_id, proposal.project_id, item.id) for item in edges]
            if len(set(node_keys)) != len(node_keys) or len(set(edge_keys)) != len(edge_keys):
                raise VersionConflict(proposal.id)
            if any(item in self._nodes for item in node_keys) or any(item in self._edges for item in edge_keys):
                raise VersionConflict(proposal.id)

            self._proposals[key] = self._copy(proposal)
            self._nodes.update({item_key: self._copy(item) for item_key, item in zip(node_keys, nodes)})
            self._edges.update({item_key: self._copy(item) for item_key, item in zip(edge_keys, edges)})
            self._projects[(user_id, project.id)] = replace(
                project, version=project.version + 1, updated_at=datetime.now(timezone.utc).isoformat(),
            )
            return self._copy(proposal)

    def put_analysis(self, user_id: str, project_id: str, cache_key: str, analysis: Mapping[str, Any]) -> None:
        with self._lock:
            self._owned_project(user_id, project_id)
            self._analyses[(user_id, project_id, cache_key)] = self._copy(dict(analysis))

    def get_analysis(self, user_id: str, project_id: str, cache_key: str) -> Analysis | None:
        with self._lock:
            item = self._analyses.get((user_id, project_id, cache_key))
            return self._copy(item) if item is not None else None

    def list_analyses(self, user_id: str, project_id: str) -> tuple[tuple[str, Analysis], ...]:
        with self._lock:
            prefix = (user_id, project_id)
            return tuple((key[2], self._copy(self._analyses[key])) for key in sorted(self._analyses) if key[:2] == prefix)

    def delete_analysis(self, user_id: str, project_id: str, cache_key: str) -> None:
        with self._lock:
            self._owned_project(user_id, project_id)
            self._analyses.pop((user_id, project_id, cache_key), None)

    def create_snapshot(self, user_id: str, snapshot: BlueprintSnapshot) -> BlueprintSnapshot:
        with self._lock:
            self._owned_project(user_id, snapshot.project_id)
            key = (user_id, snapshot.project_id, snapshot.id)
            if key in self._snapshots:
                raise VersionConflict(snapshot.id)
            self._snapshots[key] = self._copy(snapshot)
            return self._copy(snapshot)

    def list_snapshots(self, user_id: str, project_id: str) -> tuple[BlueprintSnapshot, ...]:
        with self._lock:
            prefix = (user_id, project_id)
            return tuple(self._copy(self._snapshots[key]) for key in sorted(self._snapshots) if key[:2] == prefix)

    def get_snapshot(self, user_id: str, project_id: str, snapshot_id: str) -> BlueprintSnapshot | None:
        with self._lock:
            item = self._snapshots.get((user_id, project_id, snapshot_id))
            return self._copy(item) if item is not None else None

    def save_layout(self, user_id: str, project_id: str, positions: Mapping[str, Position], expected_version: int) -> int:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id)
            version = self._layouts.get(key, (0, {}))[0]
            self._check_cas(version, expected_version, project_id)
            next_version = version + 1
            self._layouts[key] = (next_version, self._copy(dict(positions)))
            return next_version

    def get_layout(self, user_id: str, project_id: str) -> tuple[int, dict[str, Position]]:
        with self._lock:
            if (user_id, project_id) not in self._projects:
                return (0, {})
            return self._copy(self._layouts.get((user_id, project_id), (0, {})))

    def save_annotations(
        self, user_id: str, project_id: str, annotations: Sequence[CanvasAnnotation], expected_version: int,
    ) -> int:
        with self._lock:
            self._owned_project(user_id, project_id)
            if any(item.project_id != project_id or item.owner_id != user_id for item in annotations):
                raise GraphItemNotFound(project_id)
            key = (user_id, project_id)
            version = self._annotations.get(key, (0, ()))[0]
            self._check_cas(version, expected_version, project_id)
            next_version = version + 1
            self._annotations[key] = (next_version, tuple(self._copy(item) for item in annotations))
            return next_version

    def get_annotations(self, user_id: str, project_id: str) -> tuple[int, tuple[CanvasAnnotation, ...]]:
        with self._lock:
            if (user_id, project_id) not in self._projects:
                return (0, ())
            return self._copy(self._annotations.get((user_id, project_id), (0, ())))

    def store_media(self, user_id: str, media: CanvasMedia, content: bytes | bytearray) -> CanvasMedia:
        with self._lock:
            self._owned_project(user_id, media.project_id)
            if media.owner_id != user_id:
                raise InvalidMedia(media.id)
            copied = bytes(content)
            if len(copied) != media.byte_length:
                raise InvalidMedia(media.id)
            key = (user_id, media.project_id, media.id)
            if key in self._media:
                raise VersionConflict(media.id)
            self._media[key] = (self._copy(media), copied)
            return self._copy(media)

    def read_media(self, user_id: str, project_id: str, media_id: str) -> tuple[CanvasMedia, bytes] | None:
        with self._lock:
            item = self._media.get((user_id, project_id, media_id))
            return self._copy(item) if item is not None else None

    def delete_media(self, user_id: str, project_id: str, media_id: str, expected_version: int) -> None:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id, media_id)
            item = self._media.get(key)
            if item is None:
                raise GraphItemNotFound(media_id)
            self._check_cas(item[0].version, expected_version, media_id)
            del self._media[key]

    def set_user_theme(self, user_id: str, theme: ThemeChoice) -> None:
        with self._lock:
            self._user_themes[user_id] = ThemeChoice(theme)

    def get_user_theme(self, user_id: str) -> ThemeChoice:
        with self._lock:
            return self._user_themes.get(user_id, ThemeChoice.PAPER)

    def set_project_theme(self, user_id: str, project_id: str, theme: ThemeChoice | None) -> None:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id)
            if theme is None:
                self._project_themes.pop(key, None)
            else:
                self._project_themes[key] = ThemeChoice(theme)

    def get_project_theme(self, user_id: str, project_id: str) -> ThemeChoice | None:
        with self._lock:
            if (user_id, project_id) not in self._projects:
                return None
            return self._project_themes.get((user_id, project_id))


__all__ = [
    "GraphItemNotFound", "InMemoryProjectStore", "InvalidMedia", "ProjectNotFound",
    "ProjectStore", "StoreFailure", "VersionConflict",
]
