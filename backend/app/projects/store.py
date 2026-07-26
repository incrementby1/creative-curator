from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import math
from threading import RLock
from typing import Any, Callable, Mapping, Protocol, Sequence

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
Dimensions = tuple[float, float]
Analysis = dict[str, Any]


class ProjectStore(Protocol):
    def commit_idempotent_mutation(
        self, user_id: str, project_id: str, idempotency_key: str,
        request_fingerprint: str, mutate: Callable[[], Any],
    ) -> Any: ...
    def create_project(self, user_id: str, project: Project) -> Project: ...
    def get_project(self, user_id: str, project_id: str) -> Project | None: ...
    def list_projects(self, user_id: str) -> tuple[Project, ...]: ...
    def list_projects_page(self, user_id: str, limit: int) -> tuple[Project, ...]: ...
    def list_project_summary_inputs(
        self, user_id: str, limit: int,
    ) -> tuple[tuple[Project, ...], tuple[GraphNode, ...], tuple[ChallengeResolution, ...]]: ...
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
    def reject_proposal(self, user_id: str, project_id: str, proposal_id: str) -> AnalysisProposal: ...
    def commit_proposal_acceptance(
        self, user_id: str, proposal: AnalysisProposal,
        nodes: Sequence[GraphNode], edges: Sequence[GraphEdge],
        expected_proposal_version: int, expected_project_version: int,
    ) -> AnalysisProposal: ...

    def put_analysis(self, user_id: str, project_id: str, cache_key: str, analysis: Mapping[str, Any]) -> None: ...
    def get_analysis(self, user_id: str, project_id: str, cache_key: str) -> Analysis | None: ...
    def list_analyses(self, user_id: str, project_id: str) -> tuple[tuple[str, Analysis], ...]: ...
    def delete_analysis(self, user_id: str, project_id: str, cache_key: str) -> None: ...
    def claim_analysis_request(self, user_id: str, project_id: str, idempotency_key: str,
                               request_fingerprint: str, claim_token: str) -> Analysis | None: ...
    def complete_analysis_request(self, user_id: str, project_id: str, idempotency_key: str,
                                  claim_token: str, result: Mapping[str, Any]) -> None: ...
    def abandon_analysis_request(self, user_id: str, project_id: str, idempotency_key: str,
                                 claim_token: str) -> None: ...
    def commit_challenge_resolution(self, user_id: str, resolution: ChallengeResolution,
                                    expected_project_version: int) -> ChallengeResolution: ...
    def list_challenge_resolutions(self, user_id: str, project_id: str,
                                   challenge_id: str) -> tuple[ChallengeResolution, ...]: ...

    def create_snapshot(self, user_id: str, snapshot: BlueprintSnapshot,
                        expected_project_version: int) -> BlueprintSnapshot: ...
    def list_snapshots(self, user_id: str, project_id: str) -> tuple[BlueprintSnapshot, ...]: ...
    def get_snapshot(self, user_id: str, project_id: str, snapshot_id: str) -> BlueprintSnapshot | None: ...

    def save_layout(self, user_id: str, project_id: str, positions: Mapping[str, Position], expected_version: int,
                    dimensions: Mapping[str, Dimensions] | None = None) -> int: ...
    def get_layout(self, user_id: str, project_id: str) -> tuple[int, dict[str, Position]]: ...
    def get_layout_dimensions(self, user_id: str, project_id: str) -> dict[str, Dimensions]: ...
    def get_layout_state(self, user_id: str, project_id: str) -> tuple[int, dict[str, Position], dict[str, Dimensions]]: ...
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
    def __init__(self, *, clock: Callable[[], datetime] | None = None,
                 analysis_claim_lease_seconds: int = 60) -> None:
        if isinstance(analysis_claim_lease_seconds, bool) or not 1 <= analysis_claim_lease_seconds <= 300:
            raise ValueError("analysis claim lease must be between 1 and 300 seconds.")
        self._lock = RLock()
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._analysis_claim_lease_seconds = analysis_claim_lease_seconds
        self._projects: dict[tuple[str, str], Project] = {}
        self._nodes: dict[tuple[str, str, str], GraphNode] = {}
        self._edges: dict[tuple[str, str, str], GraphEdge] = {}
        self._revisions: dict[tuple[str, str, str], list[NodeRevision]] = {}
        self._proposals: dict[tuple[str, str, str], AnalysisProposal] = {}
        self._analyses: dict[tuple[str, str, str], Analysis] = {}
        self._analysis_requests: dict[tuple[str, str, str], Analysis] = {}
        self._challenge_resolutions: dict[tuple[str, str, str], ChallengeResolution] = {}
        self._snapshots: dict[tuple[str, str, str], BlueprintSnapshot] = {}
        self._layouts: dict[tuple[str, str], tuple[int, dict[str, Position]]] = {}
        self._layout_dimensions: dict[tuple[str, str], dict[str, Dimensions]] = {}
        self._annotations: dict[tuple[str, str], tuple[int, tuple[CanvasAnnotation, ...]]] = {}
        self._media: dict[tuple[str, str, str], tuple[CanvasMedia, bytes]] = {}
        self._media_claims: dict[tuple[str, str, str], str] = {}
        self._user_themes: dict[str, ThemeChoice] = {}
        self._project_themes: dict[tuple[str, str], ThemeChoice] = {}

    def commit_idempotent_mutation(
        self, user_id: str, project_id: str, idempotency_key: str,
        request_fingerprint: str, mutate: Callable[[], Any],
    ) -> Any:
        """Commit one semantic mutation and its replay value under one lock."""
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id, idempotency_key)
            current = self._analysis_requests.get(key)
            if current is not None:
                if current.get("request_fingerprint") != request_fingerprint:
                    raise VersionConflict(idempotency_key)
                if current.get("status") != "completed" or "mutation_result" not in current:
                    raise VersionConflict(idempotency_key)
                return self._copy(current["mutation_result"])
            result = mutate()
            self._analysis_requests[key] = {
                "request_fingerprint": request_fingerprint,
                "status": "completed",
                "mutation_result": self._copy(result),
            }
            return self._copy(result)

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

    def list_projects_page(self, user_id: str, limit: int) -> tuple[Project, ...]:
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
            raise ValueError("project limit must be between 1 and 100")
        return self.list_projects(user_id)[:limit]

    def list_project_summary_inputs(
        self, user_id: str, limit: int,
    ) -> tuple[tuple[Project, ...], tuple[GraphNode, ...], tuple[ChallengeResolution, ...]]:
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
            raise ValueError("summary limit must be between 1 and 100")
        with self._lock:
            projects = tuple(
                self._copy(self._projects[key]) for key in sorted(self._projects)
                if key[0] == user_id
            )[:limit]
            project_ids = {project.id for project in projects}
            nodes = tuple(
                self._copy(node) for key, node in sorted(self._nodes.items())
                if key[0] == user_id and key[1] in project_ids
            )
            resolutions = tuple(
                self._copy(item) for key, item in sorted(self._challenge_resolutions.items())
                if key[0] == user_id and key[1] in project_ids
            )
            return projects, nodes, resolutions

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

    def reject_proposal(self, user_id: str, project_id: str, proposal_id: str) -> AnalysisProposal:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id, proposal_id); current = self._proposals.get(key)
            if current is None: raise GraphItemNotFound(proposal_id)
            if current.state is ProposalState.REJECTED: return self._copy(current)
            if current.state is not ProposalState.PENDING: raise VersionConflict(proposal_id)
            rejected = replace(current, state=ProposalState.REJECTED, version=current.version + 1,
                               updated_at=datetime.now(timezone.utc).isoformat())
            self._proposals[key] = rejected
            return self._copy(rejected)

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
            if (proposal.id != current.id or proposal.project_id != current.project_id
                    or proposal.title != current.title or proposal.rationale != current.rationale
                    or proposal.target_node_ids != current.target_node_ids
                    or proposal.canonical_hash != current.canonical_hash
                    or proposal.dependency_node_versions != current.dependency_node_versions
                    or proposal.dependency_edge_versions != current.dependency_edge_versions
                    or proposal.creation_source is not current.creation_source
                    or proposal.created_at != current.created_at):
                raise VersionConflict(proposal.id)
            for node_id, version in current.dependency_node_versions:
                dependency = self._nodes.get((user_id, proposal.project_id, node_id))
                if dependency is None or dependency.version != version:
                    raise VersionConflict(node_id)
            for edge_id, version in current.dependency_edge_versions:
                dependency = self._edges.get((user_id, proposal.project_id, edge_id))
                if dependency is None or dependency.version != version:
                    raise VersionConflict(edge_id)
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

    def claim_analysis_request(self, user_id: str, project_id: str, idempotency_key: str,
                               request_fingerprint: str, claim_token: str) -> Analysis | None:
        with self._lock:
            self._owned_project(user_id, project_id)
            key = (user_id, project_id, idempotency_key)
            current = self._analysis_requests.get(key)
            if current is not None:
                if current.get("request_fingerprint") != request_fingerprint:
                    raise VersionConflict(idempotency_key)
                if current.get("status") == "completed":
                    result = current.get("result")
                    if not isinstance(result, Mapping):
                        raise StoreFailure("Stored analysis request result is invalid.")
                    return self._copy(dict(result))
                lease_expires_at = current.get("lease_expires_at")
                now = self._clock()
                if not isinstance(lease_expires_at, datetime) or now < lease_expires_at:
                    raise VersionConflict(idempotency_key)
                self._analysis_requests[key] = {
                    **current, "claim_token": claim_token,
                    "lease_expires_at": now + timedelta(seconds=self._analysis_claim_lease_seconds),
                }
                return None
            now = self._clock()
            self._analysis_requests[key] = {
                "request_fingerprint": request_fingerprint, "claim_token": claim_token,
                "status": "pending", "result": None,
                "lease_expires_at": now + timedelta(seconds=self._analysis_claim_lease_seconds),
            }
            return None

    def complete_analysis_request(self, user_id: str, project_id: str, idempotency_key: str,
                                  claim_token: str, result: Mapping[str, Any]) -> None:
        with self._lock:
            key = (user_id, project_id, idempotency_key)
            current = self._analysis_requests.get(key)
            if current is None or current.get("status") != "pending" or current.get("claim_token") != claim_token:
                raise VersionConflict(idempotency_key)
            self._analysis_requests[key] = {**current, "status": "completed",
                                            "claim_token": None, "result": self._copy(dict(result))}

    def abandon_analysis_request(self, user_id: str, project_id: str, idempotency_key: str,
                                 claim_token: str) -> None:
        with self._lock:
            key = (user_id, project_id, idempotency_key)
            current = self._analysis_requests.get(key)
            if current is not None and current.get("status") == "pending" and current.get("claim_token") == claim_token:
                del self._analysis_requests[key]

    def commit_challenge_resolution(
        self, user_id: str, resolution: ChallengeResolution, expected_project_version: int,
    ) -> ChallengeResolution:
        with self._lock:
            project = self._owned_project(user_id, resolution.project_id)
            self._check_cas(project.version, expected_project_version, project.id)
            challenge = self._nodes.get((user_id, resolution.project_id, resolution.challenge_id))
            if (resolution.resolved_by != user_id or challenge is None
                    or challenge.node_type.value != "challenge" or challenge.state is NodeState.TRASH):
                raise GraphItemNotFound(resolution.challenge_id)
            if any(key[:2] == (user_id, resolution.project_id)
                   and item.challenge_id == resolution.challenge_id
                   for key, item in self._challenge_resolutions.items()):
                raise VersionConflict(resolution.challenge_id)
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

    def create_snapshot(self, user_id: str, snapshot: BlueprintSnapshot,
                        expected_project_version: int) -> BlueprintSnapshot:
        with self._lock:
            project = self._owned_project(user_id, snapshot.project_id)
            self._check_cas(project.version, expected_project_version, project.id)
            if snapshot.project_version != expected_project_version:
                raise VersionConflict(snapshot.project_id)
            existing = tuple(
                item for item_key, item in self._snapshots.items()
                if item_key[:2] == (user_id, snapshot.project_id)
                and item.project_version == expected_project_version
            )
            if existing:
                winner = sorted(existing, key=lambda item: (item.sequence, item.id))[0]
                if (winner.canonical_json != snapshot.canonical_json
                        or winner.node_ids != snapshot.node_ids or winner.edge_ids != snapshot.edge_ids
                        or winner.readiness_warnings != snapshot.readiness_warnings
                        or winner.unresolved_assumption_ids != snapshot.unresolved_assumption_ids):
                    raise VersionConflict(snapshot.project_id)
                return self._copy(winner)
            key = (user_id, snapshot.project_id, snapshot.id)
            if key in self._snapshots:
                raise VersionConflict(snapshot.id)
            if snapshot.project_version and any(
                item.project_version == snapshot.project_version or item.sequence == snapshot.sequence
                for item_key, item in self._snapshots.items()
                if item_key[:2] == (user_id, snapshot.project_id)
            ):
                raise VersionConflict(snapshot.project_id)
            self._snapshots[key] = self._copy(snapshot)
            return self._copy(snapshot)

    def list_snapshots(self, user_id: str, project_id: str) -> tuple[BlueprintSnapshot, ...]:
        with self._lock:
            prefix = (user_id, project_id)
            items = (item for key, item in self._snapshots.items() if key[:2] == prefix)
            return tuple(self._copy(item) for item in sorted(items, key=lambda item: (item.sequence, item.id)))

    def get_snapshot(self, user_id: str, project_id: str, snapshot_id: str) -> BlueprintSnapshot | None:
        with self._lock:
            item = self._snapshots.get((user_id, project_id, snapshot_id))
            return self._copy(item) if item is not None else None

    def save_layout(self, user_id: str, project_id: str, positions: Mapping[str, Position], expected_version: int,
                    dimensions: Mapping[str, Dimensions] | None = None) -> int:
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
            normalized_dimensions: dict[str, Dimensions] = {}
            for node_id, size in (dimensions or {}).items():
                if not isinstance(node_id, str) or not node_id.strip():
                    raise ValueError("layout node ids must be non-empty strings.")
                if not isinstance(size, (tuple, list)) or len(size) != 2:
                    raise ValueError("layout dimensions must contain width and height.")
                if any(isinstance(axis, bool) or not isinstance(axis, (int, float)) for axis in size):
                    raise ValueError("layout dimensions must contain numbers.")
                value = (float(size[0]), float(size[1]))
                if not all(math.isfinite(axis) for axis in value) or not 80 <= value[0] <= 1200 or not 64 <= value[1] <= 900:
                    raise ValueError("layout dimensions must be finite and bounded.")
                normalized_dimensions[node_id.strip()] = value
            if dimensions is not None and set(normalized_dimensions) != set(normalized):
                raise ValueError("layout positions and dimensions must name the same nodes.")
            key = (user_id, project_id)
            version = self._layouts.get(key, (0, {}))[0]
            self._check_cas(version, expected_version, project_id)
            next_version = version + 1
            self._layouts[key] = (next_version, self._copy(normalized))
            self._layout_dimensions[key] = self._copy(normalized_dimensions)
            return next_version

    def get_layout(self, user_id: str, project_id: str) -> tuple[int, dict[str, Position]]:
        with self._lock:
            if (user_id, project_id) not in self._projects:
                return (0, {})
            return self._copy(self._layouts.get((user_id, project_id), (0, {})))

    def get_layout_dimensions(self, user_id: str, project_id: str) -> dict[str, Dimensions]:
        with self._lock:
            if (user_id, project_id) not in self._projects:
                return {}
            return self._copy(self._layout_dimensions.get((user_id, project_id), {}))

    def get_layout_state(self, user_id: str, project_id: str) -> tuple[int, dict[str, Position], dict[str, Dimensions]]:
        with self._lock:
            if (user_id, project_id) not in self._projects:
                return 0, {}, {}
            version, positions = self._layouts.get((user_id, project_id), (0, {}))
            return version, self._copy(positions), self._copy(self._layout_dimensions.get((user_id, project_id), {}))

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
