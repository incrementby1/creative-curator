from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import hmac
import math
from threading import RLock
from typing import Any, Mapping, Protocol, Sequence

from app.projects.types import (
    AnalysisProposal,
    BlueprintSnapshot,
    CanvasAnnotation,
    CanvasMedia,
    ChallengeResolution,
    GraphEdge,
    GraphNode,
    NodeRevision,
    NodeState,
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
    def commit_node_creation(self, user_id: str, node: GraphNode, expected_project_version: int) -> GraphNode: ...
    def get_node(self, user_id: str, project_id: str, node_id: str) -> GraphNode | None: ...
    def list_nodes(self, user_id: str, project_id: str) -> tuple[GraphNode, ...]: ...
    def update_node(self, user_id: str, node: GraphNode, expected_version: int) -> GraphNode: ...
    def delete_node(self, user_id: str, project_id: str, node_id: str, expected_version: int) -> None: ...
    def commit_node_deletion(
        self, user_id: str, project_id: str, node_id: str,
        expected_node_version: int, expected_project_version: int,
    ) -> None: ...
    def commit_node_semantic_update(
        self, user_id: str, node: GraphNode, revision: NodeRevision,
        expected_node_version: int, expected_project_version: int,
    ) -> GraphNode: ...

    def create_edge(self, user_id: str, edge: GraphEdge) -> GraphEdge: ...
    def commit_edge_creation(self, user_id: str, edge: GraphEdge, expected_project_version: int) -> GraphEdge: ...
    def get_edge(self, user_id: str, project_id: str, edge_id: str) -> GraphEdge | None: ...
    def list_edges(self, user_id: str, project_id: str) -> tuple[GraphEdge, ...]: ...
    def update_edge(self, user_id: str, edge: GraphEdge, expected_version: int) -> GraphEdge: ...
    def commit_edge_update(
        self, user_id: str, edge: GraphEdge,
        expected_edge_version: int, expected_project_version: int,
    ) -> GraphEdge: ...
    def delete_edge(self, user_id: str, project_id: str, edge_id: str, expected_version: int) -> None: ...
    def commit_edge_deletion(
        self, user_id: str, project_id: str, edge_id: str,
        expected_edge_version: int, expected_project_version: int,
    ) -> None: ...

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
    def commit_challenge_resolution(self, user_id: str, resolution: ChallengeResolution,
                                    expected_project_version: int) -> ChallengeResolution: ...
    def list_challenge_resolutions(self, user_id: str, project_id: str,
                                   challenge_id: str) -> tuple[ChallengeResolution, ...]: ...

    def create_snapshot(self, user_id: str, snapshot: BlueprintSnapshot) -> BlueprintSnapshot: ...
    def list_snapshots(self, user_id: str, project_id: str) -> tuple[BlueprintSnapshot, ...]: ...
    def get_snapshot(self, user_id: str, project_id: str, snapshot_id: str) -> BlueprintSnapshot | None: ...

    def save_layout(self, user_id: str, project_id: str, positions: Mapping[str, Position], expected_version: int) -> int: ...
    def get_layout(self, user_id: str, project_id: str) -> tuple[int, dict[str, Position]]: ...
    def save_annotations(
        self, user_id: str, project_id: str, annotations: Sequence[CanvasAnnotation], expected_version: int,
    ) -> int: ...
    def commit_annotations(
        self, user_id: str, project_id: str, annotations: Sequence[CanvasAnnotation], expected_version: int,
    ) -> int: ...
    def get_annotations(self, user_id: str, project_id: str) -> tuple[int, tuple[CanvasAnnotation, ...]]: ...

    def store_media(self, user_id: str, media: CanvasMedia, content: bytes | bytearray) -> CanvasMedia: ...
    def store_media_with_claim(
        self, user_id: str, media: CanvasMedia, content: bytes | bytearray, claim_hash: str,
    ) -> CanvasMedia: ...
    def discard_pending_media(
        self, user_id: str, project_id: str, media_id: str, claim_hash: str,
    ) -> bool: ...
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
        self._challenge_resolutions: dict[tuple[str, str, str], ChallengeResolution] = {}
        self._snapshots: dict[tuple[str, str, str], BlueprintSnapshot] = {}
        self._layouts: dict[tuple[str, str], tuple[int, dict[str, Position]]] = {}
        self._annotations: dict[tuple[str, str], tuple[int, tuple[CanvasAnnotation, ...]]] = {}
        self._media: dict[tuple[str, str, str], tuple[CanvasMedia, bytes]] = {}
        self._media_claims: dict[tuple[str, str, str], str] = {}
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

    @staticmethod
    def _increment_project(project: Project) -> Project:
        return replace(
            project,
            version=project.version + 1,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    def _validate_edge_endpoints(
        self, user_id: str, edge: GraphEdge, extra_nodes: Mapping[str, GraphNode] | None = None,
    ) -> None:
        if edge.source_node_id == edge.target_node_id:
            raise VersionConflict(edge.id)
        proposed = extra_nodes or {}
        for node_id in (edge.source_node_id, edge.target_node_id):
            node = proposed.get(node_id) or self._nodes.get((user_id, edge.project_id, node_id))
            if node is None or node.project_id != edge.project_id or node.state is NodeState.TRASH:
                raise GraphItemNotFound(node_id)

    def _validate_edge_uniqueness(
        self, user_id: str, edge: GraphEdge, *, additional: set[tuple[str, str, object]] | None = None,
    ) -> None:
        semantic_key = (edge.source_node_id, edge.target_node_id, edge.edge_type)
        for key, current in self._edges.items():
            if key[:2] == (user_id, edge.project_id) and current.id != edge.id:
                if (current.source_node_id, current.target_node_id, current.edge_type) == semantic_key:
                    raise VersionConflict(edge.id)
        if additional is not None:
            if semantic_key in additional:
                raise VersionConflict(edge.id)
            additional.add(semantic_key)

    def _reject_incident_edges(self, user_id: str, project_id: str, node_id: str) -> None:
        for key, edge in self._edges.items():
            if key[:2] == (user_id, project_id) and node_id in (edge.source_node_id, edge.target_node_id):
                raise VersionConflict(node_id)

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

    def commit_node_creation(self, user_id: str, node: GraphNode, expected_project_version: int) -> GraphNode:
        with self._lock:
            project = self._owned_project(user_id, node.project_id)
            key = (user_id, node.project_id, node.id)
            self._check_cas(project.version, expected_project_version, project.id)
            if key in self._nodes:
                raise VersionConflict(node.id)

            self._nodes[key] = self._copy(node)
            self._projects[(user_id, project.id)] = self._increment_project(project)
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
            self._reject_incident_edges(user_id, project_id, node_id)
            del self._nodes[key]

    def commit_node_deletion(
        self, user_id: str, project_id: str, node_id: str,
        expected_node_version: int, expected_project_version: int,
    ) -> None:
        with self._lock:
            project = self._owned_project(user_id, project_id)
            key = (user_id, project_id, node_id)
            current = self._nodes.get(key)
            if current is None:
                raise GraphItemNotFound(node_id)
            self._check_cas(current.version, expected_node_version, node_id)
            self._check_cas(project.version, expected_project_version, project.id)
            self._reject_incident_edges(user_id, project_id, node_id)

            del self._nodes[key]
            self._projects[(user_id, project.id)] = self._increment_project(project)

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
            revision_semantics = (
                revision.node_version, revision.title, revision.content, revision.node_type,
                revision.state, revision.created_by, revision.provenance, revision.tags,
            )
            current_semantics = (
                current.version, current.title, current.content, current.node_type,
                current.state, current.created_by, current.provenance, current.tags,
            )
            if revision_semantics != current_semantics:
                raise VersionConflict(node.id)
            if current.state is not NodeState.TRASH and node.state is NodeState.TRASH:
                self._reject_incident_edges(user_id, node.project_id, node.id)

            self._revisions.setdefault(key, []).append(self._copy(revision))
            self._nodes[key] = self._copy(node)
            self._projects[(user_id, project.id)] = self._increment_project(project)
            return self._copy(node)

    def create_edge(self, user_id: str, edge: GraphEdge) -> GraphEdge:
        with self._lock:
            self._owned_project(user_id, edge.project_id)
            key = (user_id, edge.project_id, edge.id)
            if key in self._edges:
                raise VersionConflict(edge.id)
            self._validate_edge_endpoints(user_id, edge)
            self._validate_edge_uniqueness(user_id, edge)
            self._edges[key] = self._copy(edge)
            return self._copy(edge)

    def commit_edge_creation(self, user_id: str, edge: GraphEdge, expected_project_version: int) -> GraphEdge:
        with self._lock:
            project = self._owned_project(user_id, edge.project_id)
            key = (user_id, edge.project_id, edge.id)
            self._check_cas(project.version, expected_project_version, project.id)
            if key in self._edges:
                raise VersionConflict(edge.id)
            self._validate_edge_endpoints(user_id, edge)
            self._validate_edge_uniqueness(user_id, edge)

            self._edges[key] = self._copy(edge)
            self._projects[(user_id, project.id)] = self._increment_project(project)
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
            self._validate_edge_endpoints(user_id, edge)
            self._validate_edge_uniqueness(user_id, edge)
            self._edges[key] = self._copy(edge)
            return self._copy(edge)

    def commit_edge_update(
        self, user_id: str, edge: GraphEdge,
        expected_edge_version: int, expected_project_version: int,
    ) -> GraphEdge:
        with self._lock:
            project = self._owned_project(user_id, edge.project_id)
            key = (user_id, edge.project_id, edge.id)
            current = self._edges.get(key)
            if current is None:
                raise GraphItemNotFound(edge.id)
            self._check_cas(current.version, expected_edge_version, edge.id)
            self._check_cas(project.version, expected_project_version, project.id)
            self._check_candidate_version(edge.version, expected_edge_version, edge.id)
            self._validate_edge_endpoints(user_id, edge)
            self._validate_edge_uniqueness(user_id, edge)

            self._edges[key] = self._copy(edge)
            self._projects[(user_id, project.id)] = self._increment_project(project)
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

    def commit_edge_deletion(
        self, user_id: str, project_id: str, edge_id: str,
        expected_edge_version: int, expected_project_version: int,
    ) -> None:
        with self._lock:
            project = self._owned_project(user_id, project_id)
            key = (user_id, project_id, edge_id)
            current = self._edges.get(key)
            if current is None:
                raise GraphItemNotFound(edge_id)
            self._check_cas(current.version, expected_edge_version, edge_id)
            self._check_cas(project.version, expected_project_version, project.id)

            del self._edges[key]
            self._projects[(user_id, project.id)] = self._increment_project(project)

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
            if current.state is not ProposalState.PENDING:
                raise VersionConflict(proposal.id)
            if proposal.state not in (ProposalState.PENDING, ProposalState.REJECTED):
                raise VersionConflict(proposal.id)
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
            if current.state is not ProposalState.PENDING or proposal.state is not ProposalState.ACCEPTED:
                raise VersionConflict(proposal.id)
            for item in (*nodes, *edges):
                self._check_scope(proposal.project_id, item.project_id)
            node_keys = [(user_id, proposal.project_id, item.id) for item in nodes]
            edge_keys = [(user_id, proposal.project_id, item.id) for item in edges]
            if len(set(node_keys)) != len(node_keys) or len(set(edge_keys)) != len(edge_keys):
                raise VersionConflict(proposal.id)
            if any(item in self._nodes for item in node_keys) or any(item in self._edges for item in edge_keys):
                raise VersionConflict(proposal.id)
            proposed_nodes = {item.id: item for item in nodes}
            if any(item.state is NodeState.TRASH for item in nodes):
                raise GraphItemNotFound(proposal.id)
            proposed_semantics: set[tuple[str, str, object]] = set()
            for edge in edges:
                self._validate_edge_endpoints(user_id, edge, proposed_nodes)
                self._validate_edge_uniqueness(user_id, edge, additional=proposed_semantics)

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

    def commit_challenge_resolution(
        self, user_id: str, resolution: ChallengeResolution, expected_project_version: int,
    ) -> ChallengeResolution:
        with self._lock:
            project = self._owned_project(user_id, resolution.project_id)
            self._check_cas(project.version, expected_project_version, project.id)
            challenge = self._nodes.get((user_id, resolution.project_id, resolution.challenge_id))
            if challenge is None or challenge.node_type.value != "challenge" or challenge.state is NodeState.TRASH:
                raise GraphItemNotFound(resolution.challenge_id)
            key = (user_id, resolution.project_id, resolution.id)
            if key in self._challenge_resolutions:
                raise VersionConflict(resolution.id)
            self._challenge_resolutions[key] = self._copy(resolution)
            self._projects[(user_id, project.id)] = self._increment_project(project)
            return self._copy(resolution)

    def list_challenge_resolutions(
        self, user_id: str, project_id: str, challenge_id: str,
    ) -> tuple[ChallengeResolution, ...]:
        with self._lock:
            self._owned_project(user_id, project_id)
            prefix = (user_id, project_id)
            items = (item for key, item in self._challenge_resolutions.items()
                     if key[:2] == prefix and item.challenge_id == challenge_id)
            return tuple(self._copy(item) for item in sorted(items, key=lambda item: (item.created_at, item.id)))

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
            normalized: dict[str, Position] = {}
            for node_id, position in positions.items():
                if not isinstance(node_id, str) or not node_id.strip():
                    raise ValueError("layout node ids must be non-empty strings.")
                if not isinstance(position, (tuple, list)) or len(position) != 2:
                    raise ValueError("layout positions must contain two numbers.")
                if any(isinstance(axis, bool) or not isinstance(axis, (int, float)) for axis in position):
                    raise ValueError("layout positions must contain numbers.")
                point = (float(position[0]), float(position[1]))
                if not all(math.isfinite(axis) for axis in point):
                    raise ValueError("layout positions must be finite.")
                normalized[node_id.strip()] = point
            key = (user_id, project_id)
            version = self._layouts.get(key, (0, {}))[0]
            self._check_cas(version, expected_version, project_id)
            next_version = version + 1
            self._layouts[key] = (next_version, self._copy(normalized))
            return next_version

    def get_layout(self, user_id: str, project_id: str) -> tuple[int, dict[str, Position]]:
        with self._lock:
            if (user_id, project_id) not in self._projects:
                return (0, {})
            return self._copy(self._layouts.get((user_id, project_id), (0, {})))

    def save_annotations(
        self, user_id: str, project_id: str, annotations: Sequence[CanvasAnnotation], expected_version: int,
    ) -> int:
        return self.commit_annotations(user_id, project_id, annotations, expected_version)

    def commit_annotations(
        self, user_id: str, project_id: str, annotations: Sequence[CanvasAnnotation], expected_version: int,
    ) -> int:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id)
            version, current_items = self._annotations.get(key, (0, ()))
            self._check_cas(version, expected_version, project_id)
            current = {item.id: item for item in current_items}
            seen: set[str] = set()
            for item in annotations:
                item.validate()
                if item.id in seen or item.project_id != project_id or item.owner_id != user_id:
                    raise GraphItemNotFound(item.id)
                seen.add(item.id)
                prior = current.get(item.id)
                if prior is None:
                    if item.version != 1:
                        raise VersionConflict(item.id)
                elif item != prior:
                    if item.version != prior.version + 1 or item.created_at != prior.created_at:
                        raise VersionConflict(item.id)
                    if datetime.fromisoformat(item.updated_at) <= datetime.fromisoformat(prior.updated_at):
                        raise VersionConflict(item.id)
                if item.media_id is not None and (user_id, project_id, item.media_id) not in self._media:
                    raise InvalidMedia(item.media_id)
            next_version = version + 1
            self._annotations[key] = (next_version, tuple(self._copy(item) for item in annotations))
            for item in annotations:
                if item.media_id is not None:
                    self._media_claims.pop((user_id, project_id, item.media_id), None)
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
            if len(copied) != media.byte_length or hashlib.sha256(copied).hexdigest() != media.sha256:
                raise InvalidMedia(media.id)
            key = (user_id, media.project_id, media.id)
            if key in self._media:
                raise VersionConflict(media.id)
            self._media[key] = (self._copy(media), copied)
            return self._copy(media)

    def store_media_with_claim(
        self, user_id: str, media: CanvasMedia, content: bytes | bytearray, claim_hash: str,
    ) -> CanvasMedia:
        if not isinstance(claim_hash, str) or len(claim_hash) != 64:
            raise InvalidMedia(media.id)
        with self._lock:
            stored = self.store_media(user_id, media, content)
            self._media_claims[(user_id, media.project_id, media.id)] = claim_hash
            return stored

    def discard_pending_media(
        self, user_id: str, project_id: str, media_id: str, claim_hash: str,
    ) -> bool:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id, media_id)
            expected = self._media_claims.get(key)
            if expected is None or not hmac.compare_digest(expected, claim_hash):
                return False
            annotations = self._annotations.get((user_id, project_id), (0, ()))[1]
            if any(annotation.media_id == media_id for annotation in annotations):
                return False
            if key not in self._media:
                self._media_claims.pop(key, None)
                return False
            del self._media[key]
            del self._media_claims[key]
            return True

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
            annotations = self._annotations.get((user_id, project_id), (0, ()))[1]
            if any(annotation.media_id == media_id for annotation in annotations):
                raise InvalidMedia(media_id)
            del self._media[key]
            self._media_claims.pop(key, None)

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
