from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import hashlib
import json
import secrets
from typing import Any, Mapping, Protocol, Sequence
from uuid import NAMESPACE_URL, uuid5

from app.llm.schemas import GraphAnalysisOutput
from app.projects.store import ProjectStore
from app.projects.store import GraphItemNotFound, ProjectNotFound, StoreFailure, VersionConflict
from app.projects.types import (
    AnalysisProposal, ChallengeResolution, CreationSource, GraphEdge, GraphNode, NodeState,
    ProposalState,
)


class RoutingReadiness(Protocol):
    def require_configured(self, user_id: str) -> None: ...
    def analysis_route(self, user_id: str) -> tuple[str, str]: ...


@dataclass(frozen=True)
class AnalysisContext:
    selected_node_id: str
    nodes: tuple[GraphNode, ...]
    edges: tuple[GraphEdge, ...]

    @property
    def node_ids(self) -> tuple[str, ...]:
        return tuple(node.id for node in self.nodes)

    @property
    def edge_ids(self) -> tuple[str, ...]:
        return tuple(edge.id for edge in self.edges)


class GraphAnalysisService:
    """Owner-scoped cached Hermes analysis and proposal review."""

    PROMPT_VERSION = "brand-graph-v1"
    SCHEMA_VERSION = "1"

    def __init__(self, store: ProjectStore, router: object, readiness: RoutingReadiness) -> None:
        self._store = store
        self._router = router
        self._readiness = readiness

    def require_configured(self, user_id: str) -> None:
        self._readiness.require_configured(user_id)

    @staticmethod
    def _proposal_dto(proposal: AnalysisProposal) -> dict[str, Any]:
        value = asdict(proposal)
        value["creation_source"] = proposal.creation_source.value
        value["state"] = proposal.state.value
        return value

    @staticmethod
    def _node_dto(node: GraphNode) -> dict[str, Any]:
        value = asdict(node)
        value["node_type"] = node.node_type.value
        value["state"] = node.state.value
        value["created_by"] = node.created_by.value
        return value

    @staticmethod
    def _edge_dto(edge: GraphEdge) -> dict[str, Any]:
        value = asdict(edge)
        value["edge_type"] = edge.edge_type.value
        return value

    def _project(self, user_id: str, project_id: str):
        project = self._store.get_project(user_id, project_id)
        if project is None:
            raise ProjectNotFound(project_id)
        return project

    def _context(self, user_id: str, project_id: str, selected_node_id: str) -> AnalysisContext:
        return select_analysis_context({
            "nodes": self._store.list_nodes(user_id, project_id),
            "edges": self._store.list_edges(user_id, project_id),
        }, selected_node_id)

    def analyze(self, user_id: str, project_id: str, selected_node_id: str,
                analysis_type: str, expected_project_version: int | None = None,
                idempotency_key: str | None = None) -> dict[str, Any]:
        if not isinstance(analysis_type, str) or not analysis_type.strip():
            raise ValueError("analysis_type must be a non-empty string.")
        if idempotency_key is None:
            return self._analyze_once(user_id, project_id, selected_node_id, analysis_type,
                                      expected_project_version)
        if not isinstance(idempotency_key, str) or not idempotency_key.strip():
            raise ValueError("idempotency_key must be a non-empty string.")
        request_payload = {
            "selected_node_id": selected_node_id.strip(), "analysis_type": analysis_type.strip(),
            "expected_project_version": expected_project_version,
        }
        request_fingerprint = hashlib.sha256(json.dumps(
            request_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode()).hexdigest()
        claim_token = secrets.token_urlsafe(32)
        replay = self._store.claim_analysis_request(
            user_id, project_id, idempotency_key.strip(), request_fingerprint, claim_token,
        )
        if replay is not None:
            return self._validate_replay(replay)
        try:
            result = self._analyze_once(user_id, project_id, selected_node_id, analysis_type,
                                        expected_project_version)
            self._store.complete_analysis_request(
                user_id, project_id, idempotency_key.strip(), claim_token, result,
            )
            return result
        except Exception:
            self._store.abandon_analysis_request(
                user_id, project_id, idempotency_key.strip(), claim_token,
            )
            raise

    def _analyze_once(self, user_id: str, project_id: str, selected_node_id: str,
                      analysis_type: str, expected_project_version: int | None) -> dict[str, Any]:
        project = self._project(user_id, project_id)
        if expected_project_version is not None and project.version != expected_project_version:
            raise VersionConflict(project_id)
        self._readiness.require_configured(user_id)
        provider, model = self._readiness.analysis_route(user_id)
        context = self._context(user_id, project_id, selected_node_id)
        cache_key = analysis_fingerprint(
            context, analysis_type=analysis_type, provider=provider, model=model,
            prompt_version=self.PROMPT_VERSION, schema_version=self.SCHEMA_VERSION,
        )
        cached = self._store.get_analysis(user_id, project_id, cache_key)
        if cached is not None:
            proposal_id = cached.get("proposal_id")
            if isinstance(proposal_id, str):
                proposal = self._store.get_proposal(user_id, project_id, proposal_id)
                if proposal is not None:
                    try:
                        cached_output = self._load_output(cached)
                        self._validate_output(cached_output, context)
                        if proposal.target_node_ids != cached_output.affected_node_ids:
                            raise ValueError("Cached proposal targets do not match candidate.")
                        if proposal.state is ProposalState.PENDING:
                            return self._result(proposal, cached)
                        replacement = AnalysisProposal.create(
                            project_id=project_id, title=cached_output.summary,
                            rationale=cached_output.summary,
                            target_node_ids=cached_output.affected_node_ids,
                        )
                        replacement_cache = {**cached, "proposal_id": replacement.id}
                        self._store.put_analysis(user_id, project_id, cache_key, replacement_cache)
                        self._store.put_analysis(user_id, project_id, f"proposal:{replacement.id}", replacement_cache)
                        replacement = self._store.create_proposal(user_id, replacement)
                        return self._result(replacement, replacement_cache)
                    except (KeyError, TypeError, ValueError):
                        self._store.delete_analysis(user_id, project_id, cache_key)

        user_json = {
            "selected_node_id": selected_node_id,
            "analysis_type": analysis_type,
            "nodes": {
                node.id: {"type": node.node_type.value, "title": node.title,
                          "content": node.content, "state": node.state.value,
                          "version": node.version, "provenance": node.provenance,
                          "tags": list(node.tags)}
                for node in context.nodes
            },
            "edges": [
                {"id": edge.id, "source_node_id": edge.source_node_id,
                 "target_node_id": edge.target_node_id, "edge_type": edge.edge_type.value,
                 "label": edge.label, "version": edge.version}
                for edge in context.edges
            ],
            "branch_summary": summarize_branch(context),
        }
        output = self._router.generate(
            user_id, GraphAnalysisOutput,
            "Act as Hermes, an active brand challenger. Use only supplied semantic graph context. Return proposals, never mutations.",
            user_json,
        )
        if not isinstance(output, GraphAnalysisOutput):
            output = GraphAnalysisOutput.model_validate(output, strict=True)
        self._validate_output(output, context)
        proposal = AnalysisProposal.create(
            project_id=project_id, title=output.summary, rationale=output.summary,
            target_node_ids=output.affected_node_ids,
        )
        cached_value = {
            "proposal_id": proposal.id,
            "fingerprint": cache_key,
            "dependency_node_versions": {node.id: node.version for node in context.nodes},
            "dependency_edge_versions": {edge.id: edge.version for edge in context.edges},
            "output": output.model_dump(mode="json"),
            "analysis_type": analysis_type,
            "provider": provider,
            "model": model,
            "prompt_version": self.PROMPT_VERSION,
            "schema_version": self.SCHEMA_VERSION,
        }
        self._store.put_analysis(user_id, project_id, cache_key, cached_value)
        self._store.put_analysis(user_id, project_id, f"proposal:{proposal.id}", cached_value)
        proposal = self._store.create_proposal(user_id, proposal)
        return self._result(proposal, cached_value)

    @staticmethod
    def _validate_output(output: GraphAnalysisOutput, context: AnalysisContext) -> None:
        existing = set(context.node_ids)
        keys = [node.client_key for node in output.proposed_nodes]
        if len(set(keys)) != len(keys) or any(key in existing for key in keys):
            raise ValueError("Proposal client keys must be unique and distinct from graph IDs.")
        if any(node_id not in existing for node_id in output.affected_node_ids):
            raise ValueError("Proposal affected nodes must belong to analysis context.")
        references = existing | set(keys)
        if any(edge.source_key not in references or edge.target_key not in references
               or edge.source_key == edge.target_key for edge in output.proposed_edges):
            raise ValueError("Proposal edges must reference known distinct nodes.")

    @staticmethod
    def _load_output(cached: Mapping[str, Any]) -> GraphAnalysisOutput:
        return GraphAnalysisOutput.model_validate_json(
            json.dumps(cached["output"], ensure_ascii=False, separators=(",", ":")), strict=True,
        )

    def _result(self, proposal: AnalysisProposal, cached: Mapping[str, Any]) -> dict[str, Any]:
        return {"proposal": self._proposal_dto(proposal), "candidate": cached["output"]}

    def _validate_replay(self, replay: Mapping[str, Any]) -> dict[str, Any]:
        proposal = replay.get("proposal")
        candidate = replay.get("candidate")
        if not isinstance(proposal, Mapping) or not isinstance(candidate, Mapping):
            raise StoreFailure("Stored analysis request result is invalid.")
        try:
            output = self._load_output({"output": candidate})
        except (KeyError, TypeError, ValueError) as exc:
            raise StoreFailure("Stored analysis request result is invalid.") from None
        required = {"id", "project_id", "title", "rationale", "target_node_ids", "creation_source",
                    "state", "version", "created_at", "updated_at"}
        if set(proposal) != required or proposal.get("state") != "pending" or proposal.get("version") != 1:
            raise StoreFailure("Stored analysis request result is invalid.")
        if tuple(proposal.get("target_node_ids", ())) != output.affected_node_ids:
            raise StoreFailure("Stored analysis request result is invalid.")
        return {"proposal": dict(proposal), "candidate": output.model_dump(mode="json")}

    def _analysis_for_proposal(self, user_id: str, project_id: str,
                               proposal_id: str) -> tuple[str, Mapping[str, Any]]:
        for key, analysis in self._store.list_analyses(user_id, project_id):
            if analysis.get("proposal_id") == proposal_id:
                return key, analysis
        raise GraphItemNotFound(proposal_id)

    def list_proposals(self, user_id: str, project_id: str) -> tuple[dict[str, Any], ...]:
        self._project(user_id, project_id)
        result = []
        for item in self._store.list_proposals(user_id, project_id):
            try:
                _, cached = self._analysis_for_proposal(user_id, project_id, item.id)
            except GraphItemNotFound:
                raise StoreFailure("Stored proposal candidate is unavailable.") from None
            if not isinstance(cached, Mapping):
                raise StoreFailure("Stored proposal candidate is unavailable.")
            try:
                output = self._load_output(cached)
                dependency_ids = cached.get("dependency_node_versions")
                if not isinstance(dependency_ids, Mapping):
                    raise ValueError
                nodes = tuple(self._store.get_node(user_id, project_id, node_id)
                              for node_id in sorted(dependency_ids))
                if any(node is None for node in nodes):
                    raise ValueError
                context = AnalysisContext("", tuple(node for node in nodes if node is not None), ())
                self._validate_output(output, context)
                if item.target_node_ids != output.affected_node_ids:
                    raise ValueError
            except (KeyError, TypeError, ValueError):
                raise StoreFailure("Stored proposal candidate is invalid.") from None
            result.append({**self._proposal_dto(item), "candidate": output.model_dump(mode="json")})
        return tuple(result)

    def accept(self, user_id: str, project_id: str, proposal_id: str,
               expected_project_version: int) -> dict[str, Any]:
        self._project(user_id, project_id)
        proposal = self._store.get_proposal(user_id, project_id, proposal_id)
        if proposal is None:
            raise GraphItemNotFound(proposal_id)
        project = self._project(user_id, project_id)
        if proposal.state is ProposalState.PENDING and project.version != expected_project_version:
            raise VersionConflict(project_id)
        _, cached = self._analysis_for_proposal(user_id, project_id, proposal_id)
        output = self._load_output(cached)
        context_ids = set(cached["dependency_node_versions"])
        context = AnalysisContext("", tuple(
            node for node_id in sorted(context_ids)
            if (node := self._store.get_node(user_id, project_id, node_id)) is not None
        ), ())
        self._validate_output(output, context)
        nodes, edges = self._candidate_records(project_id, proposal_id, output, context_ids)
        if proposal.state is ProposalState.ACCEPTED:
            stored_nodes = tuple(self._store.get_node(user_id, project_id, item.id) for item in nodes)
            stored_edges = tuple(self._store.get_edge(user_id, project_id, item.id) for item in edges)
            if any(item is None for item in (*stored_nodes, *stored_edges)):
                raise GraphItemNotFound(proposal_id)
            return {"proposal": self._proposal_dto(proposal),
                    "nodes": [self._node_dto(item) for item in stored_nodes if item is not None],
                    "edges": [self._edge_dto(item) for item in stored_edges if item is not None]}
        accepted = replace(proposal, state=ProposalState.ACCEPTED, version=proposal.version + 1,
                           updated_at=datetime.now(timezone.utc).isoformat())
        accepted = self._store.commit_proposal_acceptance(
            user_id, accepted, nodes, edges, proposal.version, expected_project_version,
        )
        return {"proposal": self._proposal_dto(accepted),
                "nodes": [self._node_dto(item) for item in nodes],
                "edges": [self._edge_dto(item) for item in edges]}

    @staticmethod
    def _candidate_records(project_id: str, proposal_id: str, output: GraphAnalysisOutput,
                           existing_ids: set[str]) -> tuple[tuple[GraphNode, ...], tuple[GraphEdge, ...]]:
        ids: dict[str, str] = {item: item for item in existing_ids}
        nodes = []
        for item in output.proposed_nodes:
            node = GraphNode.create(project_id, item.node_type, item.title, item.content,
                                    CreationSource.HERMES, provenance=item.rationale)
            node = replace(node, id=str(uuid5(NAMESPACE_URL, f"{proposal_id}:node:{item.client_key}")))
            ids[item.client_key] = node.id
            nodes.append(node)
        edges = []
        for index, item in enumerate(output.proposed_edges):
            edge = GraphEdge.create(project_id, ids[item.source_key], ids[item.target_key], item.edge_type)
            edge = replace(edge, id=str(uuid5(NAMESPACE_URL, f"{proposal_id}:edge:{index}")))
            edges.append(edge)
        return tuple(nodes), tuple(edges)

    def resolve_challenge(self, user_id: str, project_id: str, challenge_id: str,
                          state: str, resolution: str,
                          expected_project_version: int) -> dict[str, Any]:
        self._project(user_id, project_id)
        challenge = self._store.get_node(user_id, project_id, challenge_id)
        if challenge is None or challenge.node_type.value != "challenge" or challenge.state is NodeState.TRASH:
            raise GraphItemNotFound(challenge_id)
        record = ChallengeResolution.resolve(
            project_id=project_id, challenge_id=challenge_id, resolution=resolution,
            state=state, resolved_by=user_id,
        )
        saved = self._store.commit_challenge_resolution(user_id, record, expected_project_version)
        value = asdict(saved)
        value["state"] = saved.state.value
        return value


def _validated_graph(
    graph: Mapping[str, Sequence[object]],
) -> tuple[dict[str, GraphNode], tuple[GraphEdge, ...]]:
    raw_nodes = graph.get("nodes", ())
    raw_edges = graph.get("edges", ())
    if isinstance(raw_nodes, (str, bytes)) or isinstance(raw_edges, (str, bytes)):
        raise ValueError("Graph nodes and edges must be collections.")
    nodes: dict[str, GraphNode] = {}
    for item in raw_nodes:
        if not isinstance(item, GraphNode):
            raise ValueError("Graph nodes must be GraphNode records.")
        if item.id in nodes:
            raise ValueError("Graph node IDs must be unique.")
        if item.state is not NodeState.TRASH:
            nodes[item.id] = item
    edges: list[GraphEdge] = []
    seen_edges: set[str] = set()
    for item in raw_edges:
        if not isinstance(item, GraphEdge):
            raise ValueError("Graph edges must be GraphEdge records.")
        if item.id in seen_edges:
            raise ValueError("Graph edge IDs must be unique.")
        seen_edges.add(item.id)
        if item.source_node_id in nodes and item.target_node_id in nodes:
            edges.append(item)
    return nodes, tuple(edges)


def select_analysis_context(
    graph: Mapping[str, Sequence[object]],
    selected_node_id: str,
    max_nodes: int = 24,
    *,
    max_depth: int = 3,
    max_breadth: int = 8,
) -> AnalysisContext:
    if not isinstance(selected_node_id, str) or not selected_node_id:
        raise ValueError("selected_node_id must be a non-empty string.")
    for value, name, minimum in (
        (max_nodes, "max_nodes", 1), (max_depth, "max_depth", 0), (max_breadth, "max_breadth", 1),
    ):
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise ValueError(f"{name} must be an integer of at least {minimum}.")
    nodes, edges = _validated_graph(graph)
    if selected_node_id not in nodes:
        raise ValueError("Selected node is not present in graph.")

    adjacency: dict[str, list[tuple[str, str]]] = {node_id: [] for node_id in nodes}
    for edge in edges:
        adjacency[edge.source_node_id].append((edge.target_node_id, edge.id))
        adjacency[edge.target_node_id].append((edge.source_node_id, edge.id))
    for neighbors in adjacency.values():
        neighbors.sort()

    ordered_ids = [selected_node_id]
    selected = {selected_node_id}
    frontier = [selected_node_id]
    for _depth in range(max_depth):
        next_frontier: list[str] = []
        for node_id in frontier:
            candidates = []
            for neighbor_id, _edge_id in adjacency[node_id]:
                if neighbor_id not in selected and neighbor_id not in candidates:
                    candidates.append(neighbor_id)
            for neighbor_id in candidates[:max_breadth]:
                if len(ordered_ids) >= max_nodes:
                    break
                selected.add(neighbor_id)
                ordered_ids.append(neighbor_id)
                next_frontier.append(neighbor_id)
            if len(ordered_ids) >= max_nodes:
                break
        if not next_frontier or len(ordered_ids) >= max_nodes:
            break
        frontier = next_frontier

    context_edges = tuple(sorted(
        (edge for edge in edges if edge.source_node_id in selected and edge.target_node_id in selected),
        key=lambda edge: edge.id,
    ))
    return AnalysisContext(selected_node_id, tuple(nodes[node_id] for node_id in ordered_ids), context_edges)


def summarize_branch(context: AnalysisContext, *, max_content_length: int = 240) -> str:
    if isinstance(max_content_length, bool) or not isinstance(max_content_length, int) or max_content_length < 1:
        raise ValueError("max_content_length must be a positive integer.")
    node_parts = []
    for node in context.nodes:
        compact_content = " ".join(node.content.split())[:max_content_length]
        node_parts.append(f"{node.id}|{node.node_type.value}|{node.title}|{compact_content}")
    edge_parts = [
        f"{edge.id}|{edge.source_node_id}|{edge.edge_type.value}|{edge.target_node_id}"
        for edge in context.edges
    ]
    return "nodes:\n" + "\n".join(node_parts) + "\nedges:\n" + "\n".join(edge_parts)


def analysis_fingerprint(
    context: AnalysisContext,
    *,
    analysis_type: str,
    provider: str,
    model: str,
    prompt_version: str,
    schema_version: str,
) -> str:
    labels = {
        "analysis_type": analysis_type,
        "provider": provider,
        "model": model,
        "prompt_version": prompt_version,
        "schema_version": schema_version,
    }
    if any(not isinstance(value, str) or not value.strip() for value in labels.values()):
        raise ValueError("Fingerprint labels must be non-empty strings.")
    payload = {
        **labels,
        "selected_node_id": context.selected_node_id,
        "nodes": [
            {
                "id": node.id,
                "version": node.version,
                "type": node.node_type.value,
                "title": node.title,
                "content": node.content,
                "state": node.state.value,
                "created_by": node.created_by.value,
                "provenance": node.provenance,
                "tags": list(node.tags),
            }
            for node in sorted(context.nodes, key=lambda item: item.id)
        ],
        "edges": [
            {
                "id": edge.id,
                "version": edge.version,
                "source": edge.source_node_id,
                "target": edge.target_node_id,
                "type": edge.edge_type.value,
                "label": edge.label,
            }
            for edge in sorted(context.edges, key=lambda item: item.id)
        ],
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


__all__ = [
    "AnalysisContext", "GraphAnalysisService", "analysis_fingerprint",
    "select_analysis_context", "summarize_branch",
]
