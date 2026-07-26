"""Owner-scoped local Supabase persistence for brand projects."""
from __future__ import annotations

from dataclasses import asdict, fields
from enum import Enum
from typing import Any, Mapping, Sequence

from app.projects.store import GraphItemNotFound, InvalidMedia, ProjectNotFound, StoreFailure, VersionConflict
from app.projects.types import (
    AnalysisProposal, AnnotationType, BlueprintSnapshot, CanvasAnnotation, CanvasMedia,
    CreationSource, EdgeType, GraphEdge, GraphNode, NodeRevision, NodeState, NodeType,
    Project, ProjectStatus, ProposalState, ThemeChoice,
)


_TABLE = {
    Project: "brand_projects", GraphNode: "brand_nodes", GraphEdge: "brand_edges",
    NodeRevision: "brand_node_revisions", AnalysisProposal: "brand_proposals",
    BlueprintSnapshot: "brand_blueprint_snapshots", CanvasMedia: "brand_media",
    CanvasAnnotation: "brand_annotations",
}
_ENUMS = {
    Project: {"status": ProjectStatus, "theme": ThemeChoice},
    GraphNode: {"node_type": NodeType, "state": NodeState, "created_by": CreationSource},
    GraphEdge: {"edge_type": EdgeType}, NodeRevision: {"node_type": NodeType, "state": NodeState,
        "created_by": CreationSource},
    AnalysisProposal: {"creation_source": CreationSource, "state": ProposalState},
    CanvasAnnotation: {"annotation_type": AnnotationType},
}
_TUPLES = {
    GraphNode: {"tags"}, NodeRevision: {"tags"}, AnalysisProposal: {"target_node_ids"},
    BlueprintSnapshot: {"node_ids", "edge_ids"}, CanvasAnnotation: {"path_points"},
}


class SupabaseProjectStore:
    """ProjectStore implementation using injected service-role Supabase client."""
    def __init__(self, client: Any) -> None: self._client = client

    @staticmethod
    def encode(value: Any, *, user_id: str) -> dict[str, Any]:
        row = asdict(value)
        row["user_id"] = user_id
        if isinstance(value, Project):
            row["owner_id"] = value.owner_id
        for key, item in tuple(row.items()):
            if isinstance(item, Enum): row[key] = item.value
            elif isinstance(item, tuple): row[key] = list(item)
        return row

    @staticmethod
    def _decode(kind: type, row: Mapping[str, Any]) -> Any:
        values = {field.name: row[field.name] for field in fields(kind)}
        for name, enum in _ENUMS.get(kind, {}).items(): values[name] = enum(values[name])
        for name in _TUPLES.get(kind, set()):
            raw = values[name]
            values[name] = tuple(tuple(float(axis) for axis in point) for point in raw) if name == "path_points" else tuple(raw)
        return kind(**values)

    @staticmethod
    def _rows(result: Any) -> list[dict[str, Any]]:
        data = getattr(result, "data", None)
        if data is None: return []
        return data if isinstance(data, list) else [data]

    def _execute(self, query: Any) -> list[dict[str, Any]]:
        try: return self._rows(query.execute())
        except Exception: raise StoreFailure("Project persistence operation failed.") from None

    def _validate(self, kind: type, row: Mapping[str, Any], user_id: str, project_id: str | None = None) -> Any:
        if row.get("user_id") != user_id: raise StoreFailure("Project persistence returned invalid ownership.")
        actual = row.get("id") if kind is Project else row.get("project_id")
        expected = project_id or (row.get("id") if kind is Project else None)
        if expected is not None and actual != expected: raise StoreFailure("Project persistence returned invalid scope.")
        return self._decode(kind, row)

    def _list(self, kind: type, user_id: str, project_id: str | None = None, **filters: Any) -> tuple[Any, ...]:
        query = self._client.table(_TABLE[kind]).select("*").eq("user_id", user_id)
        if project_id is not None: query = query.eq("project_id", project_id)
        for key, value in filters.items(): query = query.eq(key, value)
        return tuple(self._validate(kind, row, user_id, project_id) for row in self._execute(query))

    def _get(self, kind: type, user_id: str, project_id: str | None, item_id: str) -> Any | None:
        query = self._client.table(_TABLE[kind]).select("*").eq("user_id", user_id)
        if kind is not Project: query = query.eq("project_id", project_id)
        rows = self._execute(query.eq("id", item_id).limit(1))
        return self._validate(kind, rows[0], user_id, project_id) if rows else None

    def _insert(self, user_id: str, value: Any) -> Any:
        rows = self._execute(self._client.table(_TABLE[type(value)]).insert(self.encode(value, user_id=user_id)))
        if not rows: raise VersionConflict(value.id)
        return self._validate(type(value), rows[0], user_id, value.id if isinstance(value, Project) else value.project_id)

    def _update(self, user_id: str, value: Any, expected_version: int) -> Any:
        query = self._client.table(_TABLE[type(value)]).update(self.encode(value, user_id=user_id)).eq("user_id", user_id)
        if not isinstance(value, Project): query = query.eq("project_id", value.project_id)
        rows = self._execute(query.eq("id", value.id).eq("version", expected_version))
        if not rows: raise VersionConflict(value.id)
        return self._validate(type(value), rows[0], user_id, value.id if isinstance(value, Project) else value.project_id)

    def _delete(self, kind: type, user_id: str, project_id: str, item_id: str, expected_version: int) -> None:
        rows = self._execute(self._client.table(_TABLE[kind]).delete().eq("user_id", user_id).eq("project_id", project_id).eq("id", item_id).eq("version", expected_version))
        if not rows: raise VersionConflict(item_id)

    def _rpc(self, name: str, payload: dict[str, Any], kind: type | None = None) -> Any:
        rows = self._execute(self._client.rpc(name, payload))
        if kind is None: return None
        if not rows: raise VersionConflict(str(payload.get("p_project_id", "conflict")))
        return self._validate(kind, rows[0], payload["p_user_id"], payload.get("p_project_id"))

    def create_project(self, user_id, project): return self._insert(user_id, project)
    def get_project(self, user_id, project_id): return self._get(Project, user_id, project_id, project_id)
    def list_projects(self, user_id): return self._list(Project, user_id)
    def update_project(self, user_id, project, expected_version): return self._update(user_id, project, expected_version)
    def create_node(self, user_id, node): return self._insert(user_id, node)
    def get_node(self, user_id, project_id, node_id): return self._get(GraphNode, user_id, project_id, node_id)
    def list_nodes(self, user_id, project_id): return self._list(GraphNode, user_id, project_id)
    def update_node(self, user_id, node, expected_version): return self._update(user_id, node, expected_version)
    def delete_node(self, user_id, project_id, node_id, expected_version): self._delete(GraphNode, user_id, project_id, node_id, expected_version)
    def create_edge(self, user_id, edge): return self._insert(user_id, edge)
    def get_edge(self, user_id, project_id, edge_id): return self._get(GraphEdge, user_id, project_id, edge_id)
    def list_edges(self, user_id, project_id): return self._list(GraphEdge, user_id, project_id)
    def update_edge(self, user_id, edge, expected_version): return self._update(user_id, edge, expected_version)
    def delete_edge(self, user_id, project_id, edge_id, expected_version): self._delete(GraphEdge, user_id, project_id, edge_id, expected_version)
    def append_revision(self, user_id, revision): return self._insert(user_id, revision)
    def list_revisions(self, user_id, project_id, node_id): return self._list(NodeRevision, user_id, project_id, node_id=node_id)
    def create_proposal(self, user_id, proposal): return self._insert(user_id, proposal)
    def get_proposal(self, user_id, project_id, proposal_id): return self._get(AnalysisProposal, user_id, project_id, proposal_id)
    def list_proposals(self, user_id, project_id): return self._list(AnalysisProposal, user_id, project_id)
    def update_proposal(self, user_id, proposal, expected_version): return self._update(user_id, proposal, expected_version)
    def create_snapshot(self, user_id, snapshot): return self._insert(user_id, snapshot)
    def list_snapshots(self, user_id, project_id): return self._list(BlueprintSnapshot, user_id, project_id)
    def get_snapshot(self, user_id, project_id, snapshot_id): return self._get(BlueprintSnapshot, user_id, project_id, snapshot_id)

    def _atomic(self, name: str, user_id: str, value: Any, expected_project_version: int, **extra: Any) -> Any:
        payload = {"p_user_id": user_id, "p_project_id": value.project_id,
                   "p_record": self.encode(value, user_id=user_id),
                   "p_expected_project_version": expected_project_version, **extra}
        return self._rpc(name, payload, type(value))
    def commit_node_creation(self, user_id, node, expected_project_version): return self._atomic("create_brand_node", user_id, node, expected_project_version)
    def commit_node_semantic_update(self, user_id, node, revision, expected_node_version, expected_project_version):
        return self._atomic("update_brand_node", user_id, node, expected_project_version,
            p_revision=self.encode(revision, user_id=user_id), p_expected_node_version=expected_node_version)
    def commit_node_deletion(self, user_id, project_id, node_id, expected_node_version, expected_project_version):
        self._rpc("delete_brand_node", {"p_user_id": user_id, "p_project_id": project_id,
            "p_node_id": node_id, "p_expected_node_version": expected_node_version,
            "p_expected_project_version": expected_project_version})
    def commit_edge_creation(self, user_id, edge, expected_project_version): return self._atomic("create_brand_edge", user_id, edge, expected_project_version)
    def commit_edge_update(self, user_id, edge, expected_edge_version, expected_project_version):
        return self._atomic("update_brand_edge", user_id, edge, expected_project_version, p_expected_edge_version=expected_edge_version)
    def commit_edge_deletion(self, user_id, project_id, edge_id, expected_edge_version, expected_project_version):
        self._rpc("delete_brand_edge", {"p_user_id": user_id, "p_project_id": project_id, "p_edge_id": edge_id,
            "p_expected_edge_version": expected_edge_version, "p_expected_project_version": expected_project_version})
    def commit_proposal_acceptance(self, user_id, proposal, nodes, edges, expected_proposal_version, expected_project_version):
        del nodes, edges, expected_proposal_version
        return self._rpc("accept_brand_proposal", {"p_user_id": user_id, "p_project_id": proposal.project_id,
            "p_proposal_id": proposal.id, "p_expected_project_version": expected_project_version}, AnalysisProposal)

    def put_analysis(self, user_id, project_id, cache_key, analysis):
        self._execute(self._client.table("brand_analysis_cache").insert({"user_id": user_id, "project_id": project_id, "cache_key": cache_key, "analysis": dict(analysis)}))
    def get_analysis(self, user_id, project_id, cache_key):
        rows = self._execute(self._client.table("brand_analysis_cache").select("*").eq("user_id", user_id).eq("project_id", project_id).eq("cache_key", cache_key).limit(1))
        return dict(rows[0]["analysis"]) if rows else None
    def list_analyses(self, user_id, project_id):
        rows = self._execute(self._client.table("brand_analysis_cache").select("*").eq("user_id", user_id).eq("project_id", project_id))
        return tuple((row["cache_key"], dict(row["analysis"])) for row in rows)
    def delete_analysis(self, user_id, project_id, cache_key):
        self._execute(self._client.table("brand_analysis_cache").delete().eq("user_id", user_id).eq("project_id", project_id).eq("cache_key", cache_key))
    def save_layout(self, user_id, project_id, positions, expected_version):
        rows = self._execute(self._client.rpc("save_brand_layout", {"p_user_id": user_id, "p_project_id": project_id, "p_positions": positions, "p_expected_version": expected_version}))
        if not rows: raise VersionConflict(project_id)
        return int(rows[0].get("version", rows[0]))
    def get_layout(self, user_id, project_id):
        rows = self._execute(self._client.table("brand_layouts").select("*").eq("user_id", user_id).eq("project_id", project_id).limit(1))
        if not rows: return (0, {})
        return int(rows[0]["version"]), {key: tuple(value) for key, value in rows[0]["positions"].items()}
    def save_annotations(self, user_id, project_id, annotations, expected_version): return self.commit_annotations(user_id, project_id, annotations, expected_version)
    def commit_annotations(self, user_id, project_id, annotations, expected_version):
        rows = self._execute(self._client.rpc("replace_brand_annotations", {"p_user_id": user_id, "p_project_id": project_id,
            "p_annotations": [self.encode(v, user_id=user_id) for v in annotations], "p_expected_version": expected_version}))
        if not rows: raise VersionConflict(project_id)
        return int(rows[0].get("version", rows[0]))
    def get_annotations(self, user_id, project_id):
        values = self._list(CanvasAnnotation, user_id, project_id)
        return (max((value.version for value in values), default=0), values)

    def store_media(self, user_id, media, content): return self.store_media_with_claim(user_id, media, content, "")
    def store_media_with_claim(self, user_id, media, content, claim_hash):
        if len(content) != media.byte_length: raise InvalidMedia(media.id)
        try: self._client.storage.from_("brand-canvas-media").upload(media.storage_key, bytes(content), {"content-type": media.mime_type})
        except Exception: raise StoreFailure("Project persistence operation failed.") from None
        row = self.encode(media, user_id=user_id); row["claim_hash"] = claim_hash or None
        rows = self._execute(self._client.table("brand_media").insert(row))
        if not rows: raise StoreFailure("Project persistence operation failed.")
        return self._validate(CanvasMedia, rows[0], user_id, media.project_id)
    def discard_pending_media(self, user_id, project_id, media_id, claim_hash):
        rows = self._execute(self._client.rpc("discard_brand_media_claim", {"p_user_id": user_id, "p_project_id": project_id, "p_media_id": media_id, "p_claim_hash": claim_hash}))
        return bool(rows)
    def read_media(self, user_id, project_id, media_id):
        media = self._get(CanvasMedia, user_id, project_id, media_id)
        if media is None: return None
        try: content = self._client.storage.from_("brand-canvas-media").download(media.storage_key)
        except Exception: raise StoreFailure("Project persistence operation failed.") from None
        return media, bytes(content)
    def delete_media(self, user_id, project_id, media_id, expected_version):
        media = self._get(CanvasMedia, user_id, project_id, media_id)
        if media is None: raise GraphItemNotFound(media_id)
        self._delete(CanvasMedia, user_id, project_id, media_id, expected_version)
        try: self._client.storage.from_("brand-canvas-media").remove([media.storage_key])
        except Exception: raise StoreFailure("Project persistence operation failed.") from None
    def set_user_theme(self, user_id, theme):
        self._execute(self._client.table("brand_user_preferences").insert({"user_id": user_id, "theme": theme.value}))
    def get_user_theme(self, user_id):
        rows = self._execute(self._client.table("brand_user_preferences").select("theme").eq("user_id", user_id).limit(1))
        return ThemeChoice(rows[0]["theme"]) if rows else ThemeChoice.PAPER
    def set_project_theme(self, user_id, project_id, theme):
        rows = self._execute(self._client.table("brand_projects").update({"theme_override": theme.value if theme else None}).eq("user_id", user_id).eq("id", project_id))
        if not rows: raise ProjectNotFound(project_id)
    def get_project_theme(self, user_id, project_id):
        rows = self._execute(self._client.table("brand_projects").select("theme_override").eq("user_id", user_id).eq("id", project_id).limit(1))
        if not rows: raise ProjectNotFound(project_id)
        return ThemeChoice(rows[0]["theme_override"]) if rows[0].get("theme_override") else None


__all__ = ["SupabaseProjectStore"]
