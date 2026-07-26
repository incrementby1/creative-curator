from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Mapping, Protocol, Sequence

from app.projects.store import ProjectStore
from app.projects.types import GraphEdge, GraphNode, NodeState


class RoutingReadiness(Protocol):
    def require_configured(self, user_id: str) -> None: ...


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
    """Composition boundary for routed graph analysis; Task 7 adds execution."""

    def __init__(self, store: ProjectStore, router: object, readiness: RoutingReadiness) -> None:
        self._store = store
        self._router = router
        self._readiness = readiness

    def require_configured(self, user_id: str) -> None:
        self._readiness.require_configured(user_id)


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
