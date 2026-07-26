from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from typing import Mapping

from app.projects.store import ProjectNotFound, ProjectStore, VersionConflict
from app.projects.types import BlueprintSnapshot, ChallengeState, GraphNode, NodeState, NodeType


REQUIRED_BLUEPRINT_SECTIONS = (
    "purpose", "audience", "positioning", "promise", "personality-voice",
    "naming", "messaging", "visual-direction", "evidence-assumptions",
    "unresolved-challenges", "next-actions",
)
_TERMINAL_CHALLENGE_STATES = {
    ChallengeState.RESOLVED, ChallengeState.DEFERRED, ChallengeState.OVERRIDDEN,
}


@dataclass(frozen=True)
class BlueprintReadinessSection:
    ready: bool
    approved_decision_ids: tuple[str, ...]
    blocking_challenge_ids: tuple[str, ...]


@dataclass(frozen=True)
class BlueprintReadiness:
    project_id: str
    project_version: int
    ready: bool
    sections: Mapping[str, BlueprintReadinessSection]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class BlueprintSection:
    ready: bool
    source_node_ids: tuple[str, ...] | list[str]
    decision_ids: tuple[str, ...] | list[str]
    evidence_ids: tuple[str, ...] | list[str]
    assumption_ids: tuple[str, ...] | list[str]
    challenge_ids: tuple[str, ...] | list[str]
    blocking_challenge_ids: tuple[str, ...] | list[str]
    entries: tuple[dict[str, str], ...] | list[dict[str, str]]

    def __post_init__(self) -> None:
        for name in ("source_node_ids", "decision_ids", "evidence_ids", "assumption_ids",
                     "challenge_ids", "blocking_challenge_ids"):
            object.__setattr__(self, name, tuple(getattr(self, name)))
        object.__setattr__(self, "entries", tuple(dict(item) for item in self.entries))


def _normalized_tags(node: GraphNode) -> tuple[str, ...]:
    tags: list[str] = []
    for raw in node.tags:
        tag = "-".join(raw.strip().lower().replace("_", "-").replace("/", "-").split())
        if tag.startswith("section:"):
            tag = tag.removeprefix("section:")
        tags.append(tag)
    return tuple(sorted(set(tags)))


def _section_tags(node: GraphNode) -> tuple[str, ...]:
    tags = [tag for tag in _normalized_tags(node) if tag in REQUIRED_BLUEPRINT_SECTIONS]
    return tuple(sorted(set(tags), key=REQUIRED_BLUEPRINT_SECTIONS.index))


def _section_members(section: str, nodes: tuple[GraphNode, ...], resolved: set[str]) -> tuple[GraphNode, ...]:
    def included(node: GraphNode) -> bool:
        if section in _section_tags(node):
            return True
        if section == "evidence-assumptions":
            return node.node_type in {NodeType.EVIDENCE, NodeType.ASSUMPTION}
        if section == "unresolved-challenges":
            return node.node_type is NodeType.CHALLENGE and node.id not in resolved
        return False
    return tuple(node for node in nodes if included(node))


class BlueprintCompiler:
    def __init__(self, store: ProjectStore) -> None:
        self._store = store

    def _project(self, user_id: str, project_id: str):
        project = self._store.get_project(user_id, project_id)
        if project is None:
            raise ProjectNotFound(project_id)
        return project

    def _inputs(self, user_id: str, project_id: str):
        project = self._project(user_id, project_id)
        nodes = tuple(sorted(
            (node for node in self._store.list_nodes(user_id, project_id) if node.state is not NodeState.TRASH),
            key=lambda node: node.id,
        ))
        resolved: set[str] = set()
        for challenge in (node for node in nodes if node.node_type is NodeType.CHALLENGE):
            resolutions = self._store.list_challenge_resolutions(user_id, project_id, challenge.id)
            if any(item.state in _TERMINAL_CHALLENGE_STATES for item in resolutions):
                resolved.add(challenge.id)
        live_ids = {node.id for node in nodes}
        edges = tuple(sorted(
            (edge for edge in self._store.list_edges(user_id, project_id)
             if edge.source_node_id in live_ids and edge.target_node_id in live_ids),
            key=lambda edge: edge.id,
        ))
        confirmed = self._project(user_id, project_id)
        if confirmed.version != project.version:
            raise VersionConflict(project_id)
        return project, nodes, edges, resolved

    @staticmethod
    def _readiness(project, nodes: tuple[GraphNode, ...], resolved: set[str]) -> BlueprintReadiness:
        sections: dict[str, BlueprintReadinessSection] = {}
        warnings: list[str] = []
        for section in REQUIRED_BLUEPRINT_SECTIONS:
            members = _section_members(section, nodes, resolved)
            decisions = tuple(node.id for node in members
                              if node.node_type is NodeType.DECISION and node.state is NodeState.APPROVED)
            blockers = tuple(node.id for node in members
                             if node.node_type is NodeType.CHALLENGE and node.id not in resolved
                             and "non-blocking" not in _normalized_tags(node))
            ready = bool(decisions) and not blockers
            sections[section] = BlueprintReadinessSection(ready, decisions, blockers)
            if not decisions:
                warnings.append(f"{section}: approved decision required")
            if blockers:
                warnings.append(f"{section}: unresolved blocking challenge")
        return BlueprintReadiness(project.id, project.version, all(item.ready for item in sections.values()),
                                  sections, tuple(warnings))

    def readiness(self, user_id: str, project_id: str) -> BlueprintReadiness:
        project, nodes, _edges, resolved = self._inputs(user_id, project_id)
        return self._readiness(project, nodes, resolved)

    def list_snapshots(self, user_id: str, project_id: str) -> tuple[BlueprintSnapshot, ...]:
        self._project(user_id, project_id)
        return self._store.list_snapshots(user_id, project_id)

    def get_snapshot(self, user_id: str, project_id: str, snapshot_id: str) -> BlueprintSnapshot | None:
        self._project(user_id, project_id)
        return self._store.get_snapshot(user_id, project_id, snapshot_id)

    def compile(self, user_id: str, project_id: str, *, expected_project_version: int) -> BlueprintSnapshot:
        project, nodes, edges, resolved = self._inputs(user_id, project_id)
        if project.version != expected_project_version:
            raise VersionConflict(project_id)
        all_snapshots = self._store.list_snapshots(user_id, project_id)
        existing = tuple(item for item in all_snapshots
                         if item.project_version == project.version)
        if existing:
            candidate = sorted(existing, key=lambda item: (item.sequence, item.id))[0]
            return self._store.create_snapshot(user_id, candidate, project.version)

        readiness = self._readiness(project, nodes, resolved)
        sections: dict[str, BlueprintSection] = {}
        for section in REQUIRED_BLUEPRINT_SECTIONS:
            members = _section_members(section, nodes, resolved)
            by_type = lambda kind: tuple(node.id for node in members if node.node_type is kind)
            sections[section] = BlueprintSection(
                readiness.sections[section].ready, tuple(node.id for node in members),
                by_type(NodeType.DECISION), by_type(NodeType.EVIDENCE), by_type(NodeType.ASSUMPTION),
                tuple(node.id for node in members if node.node_type is NodeType.CHALLENGE and node.id not in resolved),
                readiness.sections[section].blocking_challenge_ids,
                tuple({"id": node.id, "title": node.title, "content": node.content,
                       "type": node.node_type.value, "rationale": node.provenance or ""}
                      for node in members),
            )
        unresolved_assumptions = tuple(node.id for node in nodes if node.node_type is NodeType.ASSUMPTION)
        payload = {
            "project_id": project.id,
            "project_title": project.title,
            "project_version": project.version,
            "sections": {key: asdict(value) for key, value in sections.items()},
            "unresolved_assumption_ids": unresolved_assumptions,
            "readiness_warnings": readiness.warnings,
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        snapshot = BlueprintSnapshot.create_compiled(
            project_id=project.id, project_version=project.version,
            sequence=max((item.sequence for item in all_snapshots), default=0) + 1,
            canonical_json=canonical, node_ids=(node.id for node in nodes),
            edge_ids=(edge.id for edge in edges),
            readiness_warnings=readiness.warnings,
            unresolved_assumption_ids=unresolved_assumptions,
        )
        return self._store.create_snapshot(user_id, snapshot, project.version)


__all__ = [
    "BlueprintCompiler", "BlueprintReadiness", "BlueprintReadinessSection", "BlueprintSection",
    "REQUIRED_BLUEPRINT_SECTIONS",
]
