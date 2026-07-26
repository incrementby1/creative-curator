"""Owner-scoped local Supabase persistence for brand projects."""
from __future__ import annotations

from dataclasses import asdict, fields
from enum import Enum
import hashlib
import hmac
import math
import secrets
from threading import RLock
from typing import Any, Mapping, Sequence

from app.projects.store import GraphItemNotFound, InvalidMedia, ProjectNotFound, StoreFailure, VersionConflict
from app.projects.types import (
    AnalysisProposal, AnnotationType, BlueprintSnapshot, CanvasAnnotation, CanvasMedia,
    ChallengeResolution, ChallengeState,
    CreationSource, EdgeType, GraphEdge, GraphNode, NodeRevision, NodeState, NodeType,
    Project, ProjectStatus, ProposalState, ThemeChoice,
)


_TABLE = {
    Project: "brand_projects", GraphNode: "brand_nodes", GraphEdge: "brand_edges",
    NodeRevision: "brand_node_revisions", AnalysisProposal: "brand_proposals",
    BlueprintSnapshot: "brand_blueprint_snapshots", CanvasMedia: "brand_media",
    CanvasAnnotation: "brand_annotations", ChallengeResolution: "brand_challenge_resolutions",
}
_ENUMS = {
    Project: {"status": ProjectStatus, "theme": ThemeChoice},
    GraphNode: {"node_type": NodeType, "state": NodeState, "created_by": CreationSource},
    GraphEdge: {"edge_type": EdgeType}, NodeRevision: {"node_type": NodeType, "state": NodeState,
        "created_by": CreationSource},
    AnalysisProposal: {"creation_source": CreationSource, "state": ProposalState},
    CanvasAnnotation: {"annotation_type": AnnotationType},
    ChallengeResolution: {"state": ChallengeState},
}
_TUPLES = {
    GraphNode: {"tags"}, NodeRevision: {"tags"}, AnalysisProposal: {"target_node_ids"},
    BlueprintSnapshot: {"node_ids", "edge_ids", "readiness_warnings", "unresolved_assumption_ids"},
    CanvasAnnotation: {"path_points"},
}


class MediaCleanupFailure(StoreFailure):
    """Uploaded object needs deterministic removal retry."""
    __slots__ = ("_user_id", "_project_id", "_storage_key", "_cleanup_token")
    def __init__(self, user_id: str, project_id: str, storage_key: str, cleanup_token: str) -> None:
        super().__init__("Project media cleanup required.")
        object.__setattr__(self, "_user_id", user_id); object.__setattr__(self, "_project_id", project_id)
        object.__setattr__(self, "_storage_key", storage_key); object.__setattr__(self, "_cleanup_token", cleanup_token)
    @property
    def user_id(self): return self._user_id
    @property
    def project_id(self): return self._project_id
    @property
    def storage_key(self): return self._storage_key
    @property
    def cleanup_token(self): return self._cleanup_token


class SupabaseProjectStore:
    """ProjectStore implementation using injected service-role Supabase client."""
    def __init__(self, client: Any) -> None:
        self._client = client
        self._cleanup_lock = RLock()
        self._pending_cleanups: dict[str, tuple[str, str, str]] = {}

    @staticmethod
    def encode(value: Any, *, user_id: str) -> dict[str, Any]:
        row = asdict(value)
        row["user_id"] = user_id
        if isinstance(value, Project):
            row["owner_id"] = value.owner_id
        for key, item in tuple(row.items()):
            if isinstance(item, Enum): row[key] = item.value
            elif isinstance(item, tuple): row[key] = list(item)
        if isinstance(value, AnalysisProposal):
            row["dependency_node_versions"] = dict(value.dependency_node_versions)
            row["dependency_edge_versions"] = dict(value.dependency_edge_versions)
        return row

    @staticmethod
    def _decode(kind: type, row: Mapping[str, Any]) -> Any:
        values = {field.name: row[field.name] for field in fields(kind)}
        if kind is AnalysisProposal:
            values["dependency_node_versions"] = tuple(sorted(values["dependency_node_versions"].items()))
            values["dependency_edge_versions"] = tuple(sorted(values["dependency_edge_versions"].items()))
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

    def _execute(self, query: Any, error_map: Mapping[str, tuple[type[StoreFailure], str]] | None = None) -> list[dict[str, Any]]:
        try: return self._rows(query.execute())
        except Exception as exc:
            code = getattr(exc, "code", None)
            if code is None and isinstance(getattr(exc, "args", None), tuple) and exc.args and isinstance(exc.args[0], dict):
                code = exc.args[0].get("code")
            if error_map and code in error_map:
                error_type, item_id = error_map[code]
                raise error_type(item_id) from None
            if code in {"23505", "40001", "P0001", "P2001", "P2002", "P2301"}: raise VersionConflict("conflict") from None
            if code in {"P0002", "P2003", "P2005"}: raise GraphItemNotFound("missing") from None
            if code == "P2004": raise InvalidMedia("media") from None
            if code == "P2100": raise ProjectNotFound("project") from None
            raise StoreFailure("Project persistence operation failed.") from None

    def _validate(self, kind: type, row: Mapping[str, Any], user_id: str, project_id: str | None = None,
                  item_id: str | None = None, expected_version: int | None = None) -> Any:
        if row.get("user_id") != user_id: raise StoreFailure("Project persistence returned invalid ownership.")
        actual = row.get("id") if kind is Project else row.get("project_id")
        expected = project_id or (row.get("id") if kind is Project else None)
        if expected is not None and actual != expected: raise StoreFailure("Project persistence returned invalid scope.")
        if item_id is not None and row.get("id") != item_id: raise StoreFailure("Project persistence returned invalid identity.")
        if expected_version is not None and row.get("version") != expected_version: raise StoreFailure("Project persistence returned invalid version.")
        return self._decode(kind, row)

    def _list(self, kind: type, user_id: str, project_id: str | None = None, **filters: Any) -> tuple[Any, ...]:
        query = self._client.table(_TABLE[kind]).select("*").eq("user_id", user_id)
        if project_id is not None: query = query.eq("project_id", project_id)
        for key, value in filters.items(): query = query.eq(key, value)
        if kind is NodeRevision: query = query.order("node_version").order("id")
        elif kind is BlueprintSnapshot: query = query.order("sequence").order("id")
        else: query = query.order("id")
        return tuple(self._validate(kind, row, user_id, project_id) for row in self._execute(query))

    def _get(self, kind: type, user_id: str, project_id: str | None, item_id: str) -> Any | None:
        query = self._client.table(_TABLE[kind]).select("*").eq("user_id", user_id)
        if kind is not Project: query = query.eq("project_id", project_id)
        rows = self._execute(query.eq("id", item_id).limit(1))
        return self._validate(kind, rows[0], user_id, project_id, item_id) if rows else None

    def _insert(self, user_id: str, value: Any) -> Any:
        fk_type = GraphItemNotFound if isinstance(value, (GraphEdge, NodeRevision)) else ProjectNotFound
        rows = self._execute(self._client.table(_TABLE[type(value)]).insert(self.encode(value, user_id=user_id)),
                             {"23503": (fk_type, value.project_id if isinstance(value, GraphNode) else value.id)})
        if not rows: raise VersionConflict(value.id)
        return self._validate(type(value), rows[0], user_id, value.id if isinstance(value, Project) else value.project_id, value.id, value.version)

    def _update(self, user_id: str, value: Any, expected_version: int) -> Any:
        if value.version != expected_version + 1: raise VersionConflict(value.id)
        query = self._client.table(_TABLE[type(value)]).update(self.encode(value, user_id=user_id)).eq("user_id", user_id)
        if not isinstance(value, Project): query = query.eq("project_id", value.project_id)
        if isinstance(value, AnalysisProposal): query = query.eq("state", "pending")
        rows = self._execute(query.eq("id", value.id).eq("version", expected_version),
                             {"23503": (GraphItemNotFound, value.id)})
        if not rows:
            project_id = value.id if isinstance(value, Project) else value.project_id
            if self._get(type(value), user_id, project_id, value.id) is None:
                if isinstance(value, Project): raise ProjectNotFound(value.id)
                raise GraphItemNotFound(value.id)
            raise VersionConflict(value.id)
        return self._validate(type(value), rows[0], user_id, value.id if isinstance(value, Project) else value.project_id, value.id, value.version)

    def _delete(self, kind: type, user_id: str, project_id: str, item_id: str, expected_version: int) -> None:
        error_map = {"23503": (VersionConflict, item_id)} if kind is GraphNode else None
        rows = self._execute(self._client.table(_TABLE[kind]).delete().eq("user_id", user_id).eq("project_id", project_id).eq("id", item_id).eq("version", expected_version), error_map)
        if not rows:
            if self._get(kind, user_id, project_id, item_id) is None: raise GraphItemNotFound(item_id)
            raise VersionConflict(item_id)

    def _rpc(self, name: str, payload: dict[str, Any], kind: type | None = None,
             item_id: str | None = None, expected_version: int | None = None) -> Any:
        rows = self._execute(self._client.rpc(name, payload))
        if kind is None: return None
        if not rows: raise VersionConflict(str(payload.get("p_project_id", "conflict")))
        return self._validate(kind, rows[0], payload["p_user_id"], payload.get("p_project_id"), item_id, expected_version)

    def create_project(self, user_id, project):
        if project.owner_id != user_id: raise ProjectNotFound(project.id)
        return self._insert(user_id, project)
    def get_project(self, user_id, project_id): return self._get(Project, user_id, project_id, project_id)
    def list_projects(self, user_id): return self._list(Project, user_id)
    def update_project(self, user_id, project, expected_version):
        if project.owner_id != user_id: raise ProjectNotFound(project.id)
        return self._update(user_id, project, expected_version)
    def create_node(self, user_id, node): return self._insert(user_id, node)
    def get_node(self, user_id, project_id, node_id): return self._get(GraphNode, user_id, project_id, node_id)
    def list_nodes(self, user_id, project_id): return self._list(GraphNode, user_id, project_id)
    def update_node(self, user_id, node, expected_version): return self._update(user_id, node, expected_version)
    def delete_node(self, user_id, project_id, node_id, expected_version): self._delete(GraphNode, user_id, project_id, node_id, expected_version)
    def create_edge(self, user_id, edge):
        return self._rpc("create_brand_edge_direct", {"p_user_id": user_id, "p_project_id": edge.project_id,
            "p_record": self.encode(edge, user_id=user_id)}, GraphEdge, edge.id, edge.version)
    def get_edge(self, user_id, project_id, edge_id): return self._get(GraphEdge, user_id, project_id, edge_id)
    def list_edges(self, user_id, project_id): return self._list(GraphEdge, user_id, project_id)
    def update_edge(self, user_id, edge, expected_version):
        if edge.version != expected_version + 1: raise VersionConflict(edge.id)
        return self._rpc("update_brand_edge_direct", {"p_user_id": user_id, "p_project_id": edge.project_id,
            "p_record": self.encode(edge, user_id=user_id), "p_expected_edge_version": expected_version},
            GraphEdge, edge.id, edge.version)
    def delete_edge(self, user_id, project_id, edge_id, expected_version): self._delete(GraphEdge, user_id, project_id, edge_id, expected_version)
    def append_revision(self, user_id, revision): return self._insert(user_id, revision)
    def list_revisions(self, user_id, project_id, node_id): return self._list(NodeRevision, user_id, project_id, node_id=node_id)
    def create_proposal(self, user_id, proposal): return self._insert(user_id, proposal)
    def get_proposal(self, user_id, project_id, proposal_id): return self._get(AnalysisProposal, user_id, project_id, proposal_id)
    def list_proposals(self, user_id, project_id): return self._list(AnalysisProposal, user_id, project_id)
    def update_proposal(self, user_id, proposal, expected_version):
        if proposal.version != expected_version + 1 or proposal.state not in {ProposalState.PENDING, ProposalState.REJECTED}:
            raise VersionConflict(proposal.id)
        return self._update(user_id, proposal, expected_version)
    def create_snapshot(self, user_id, snapshot, expected_project_version):
        if snapshot.project_version != expected_project_version:
            raise VersionConflict(snapshot.project_id)
        encoded = self.encode(snapshot, user_id=user_id)
        rows = self._execute(self._client.rpc("create_brand_blueprint_snapshot", {
            "p_user_id": user_id, "p_project_id": snapshot.project_id,
            "p_snapshot": encoded, "p_expected_project_version": expected_project_version,
        }), {"40001": (VersionConflict, snapshot.project_id), "P2100": (ProjectNotFound, snapshot.project_id)})
        if len(rows) != 1:
            raise StoreFailure("Project persistence returned invalid snapshot result.")
        result = self._validate(BlueprintSnapshot, rows[0], user_id, snapshot.project_id,
                                expected_version=1)
        if (not isinstance(result.id, str) or not result.id or result.sequence < 1
                or result.project_version != expected_project_version
                or result.canonical_json != snapshot.canonical_json
                or result.node_ids != snapshot.node_ids or result.edge_ids != snapshot.edge_ids
                or result.readiness_warnings != snapshot.readiness_warnings
                or result.unresolved_assumption_ids != snapshot.unresolved_assumption_ids):
            raise StoreFailure("Project persistence returned invalid snapshot payload.")
        return result
    def list_snapshots(self, user_id, project_id): return self._list(BlueprintSnapshot, user_id, project_id)
    def get_snapshot(self, user_id, project_id, snapshot_id): return self._get(BlueprintSnapshot, user_id, project_id, snapshot_id)

    def _atomic(self, name: str, user_id: str, value: Any, expected_project_version: int, **extra: Any) -> Any:
        payload = {"p_user_id": user_id, "p_project_id": value.project_id,
                   "p_record": self.encode(value, user_id=user_id),
                   "p_expected_project_version": expected_project_version, **extra}
        return self._rpc(name, payload, type(value), value.id, value.version)
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
        if proposal.state is not ProposalState.ACCEPTED or proposal.version != expected_proposal_version + 1:
            raise VersionConflict(proposal.id)
        accepted = self.encode(proposal, user_id=user_id)
        return self._rpc("accept_brand_proposal", {"p_user_id": user_id, "p_project_id": proposal.project_id,
            "p_proposal": accepted, "p_nodes": [self.encode(value, user_id=user_id) for value in nodes],
            "p_edges": [self.encode(value, user_id=user_id) for value in edges],
            "p_expected_proposal_version": expected_proposal_version,
            "p_expected_project_version": expected_project_version}, AnalysisProposal, proposal.id, proposal.version)

    def put_analysis(self, user_id, project_id, cache_key, analysis):
        self._execute(self._client.table("brand_analysis_cache").upsert({"user_id": user_id, "project_id": project_id, "cache_key": cache_key, "analysis": dict(analysis)}, on_conflict="user_id,project_id,cache_key"))
    def get_analysis(self, user_id, project_id, cache_key):
        rows = self._execute(self._client.table("brand_analysis_cache").select("*").eq("user_id", user_id).eq("project_id", project_id).eq("cache_key", cache_key).limit(1))
        return dict(rows[0]["analysis"]) if rows else None
    def list_analyses(self, user_id, project_id):
        rows = self._execute(self._client.table("brand_analysis_cache").select("*").eq("user_id", user_id).eq("project_id", project_id).order("cache_key"))
        return tuple((row["cache_key"], dict(row["analysis"])) for row in rows)
    def delete_analysis(self, user_id, project_id, cache_key):
        self._execute(self._client.table("brand_analysis_cache").delete().eq("user_id", user_id).eq("project_id", project_id).eq("cache_key", cache_key))
    def claim_analysis_request(self, user_id, project_id, idempotency_key, request_fingerprint, claim_token):
        token_hash = hashlib.sha256(claim_token.encode("utf-8")).hexdigest()
        rows = self._execute(self._client.rpc("claim_brand_analysis_request", {
            "p_user_id": user_id, "p_project_id": project_id, "p_idempotency_key": idempotency_key,
            "p_request_fingerprint": request_fingerprint, "p_claim_hash": token_hash,
            "p_lease_seconds": 60,
        }), {"P2201": (VersionConflict, idempotency_key), "P2202": (VersionConflict, idempotency_key)})
        if len(rows) != 1 or rows[0].get("status") not in {"claimed", "completed"}:
            raise StoreFailure("Project persistence returned invalid analysis claim.")
        if rows[0]["status"] == "claimed":
            return None
        result = rows[0].get("result")
        if not isinstance(result, dict):
            raise StoreFailure("Project persistence returned invalid analysis result.")
        return dict(result)
    def complete_analysis_request(self, user_id, project_id, idempotency_key, claim_token, result):
        token_hash = hashlib.sha256(claim_token.encode("utf-8")).hexdigest()
        rows = self._execute(self._client.rpc("complete_brand_analysis_request", {
            "p_user_id": user_id, "p_project_id": project_id, "p_idempotency_key": idempotency_key,
            "p_claim_hash": token_hash, "p_result": dict(result),
        }), {"P2203": (VersionConflict, idempotency_key)})
        expected = {"completed": True, "user_id": user_id, "project_id": project_id,
                    "idempotency_key": idempotency_key, "result": dict(result)}
        if len(rows) != 1 or rows[0] != expected:
            raise StoreFailure("Project persistence returned invalid analysis completion.")
    def abandon_analysis_request(self, user_id, project_id, idempotency_key, claim_token):
        token_hash = hashlib.sha256(claim_token.encode("utf-8")).hexdigest()
        self._execute(self._client.rpc("abandon_brand_analysis_request", {
            "p_user_id": user_id, "p_project_id": project_id, "p_idempotency_key": idempotency_key,
            "p_claim_hash": token_hash,
        }))
    def commit_challenge_resolution(self, user_id, resolution, expected_project_version):
        return self._rpc("resolve_brand_challenge", {"p_user_id": user_id,
            "p_project_id": resolution.project_id,
            "p_resolution": self.encode(resolution, user_id=user_id),
            "p_expected_project_version": expected_project_version},
            ChallengeResolution, resolution.id, resolution.version)
    def list_challenge_resolutions(self, user_id, project_id, challenge_id):
        query = self._client.table("brand_challenge_resolutions").select("*").eq("user_id", user_id).eq(
            "project_id", project_id).eq("challenge_id", challenge_id).order("created_at").order("id")
        return tuple(self._validate(ChallengeResolution, row, user_id, project_id)
                     for row in self._execute(query))
    def save_layout(self, user_id, project_id, positions, expected_version):
        if not isinstance(positions, Mapping): raise ValueError("layout positions must be a mapping.")
        normalized = {}
        for node_id, position in positions.items():
            if not isinstance(node_id, str) or not node_id.strip(): raise ValueError("layout node ids must be non-empty strings.")
            if not isinstance(position, (tuple, list)) or len(position) != 2: raise ValueError("layout positions must contain two numbers.")
            if any(isinstance(axis, bool) or not isinstance(axis, (int, float)) for axis in position): raise ValueError("layout positions must contain numbers.")
            point = (float(position[0]), float(position[1]))
            if not all(math.isfinite(axis) for axis in point): raise ValueError("layout positions must be finite.")
            normalized[node_id.strip()] = point
        rows = self._execute(self._client.rpc("save_brand_layout", {"p_user_id": user_id, "p_project_id": project_id, "p_positions": normalized, "p_expected_version": expected_version}))
        if not rows: raise VersionConflict(project_id)
        raw = rows[0].get("version") if isinstance(rows[0], dict) else rows[0]
        version = int(raw)
        if version != expected_version + 1: raise StoreFailure("Project persistence returned invalid version.")
        return version
    def get_layout(self, user_id, project_id):
        rows = self._execute(self._client.table("brand_layouts").select("*").eq("user_id", user_id).eq("project_id", project_id).limit(1))
        if not rows: return (0, {})
        row = rows[0]
        if row.get("user_id") != user_id or row.get("project_id") != project_id: raise StoreFailure("Project persistence returned invalid scope.")
        positions = row.get("positions")
        if not isinstance(positions, dict): raise StoreFailure("Project persistence returned invalid layout.")
        normalized = {}
        try:
            for key, value in positions.items():
                if not isinstance(key, str) or not key or not isinstance(value, (list, tuple)) or len(value) != 2: raise ValueError
                if any(isinstance(axis, bool) or not isinstance(axis, (int, float)) or not math.isfinite(float(axis)) for axis in value): raise ValueError
                normalized[key] = (float(value[0]), float(value[1]))
        except (TypeError, ValueError): raise StoreFailure("Project persistence returned invalid layout.") from None
        return int(row["version"]), normalized
    def save_annotations(self, user_id, project_id, annotations, expected_version): return self.commit_annotations(user_id, project_id, annotations, expected_version)
    def commit_annotations(self, user_id, project_id, annotations, expected_version):
        rows = self._execute(self._client.rpc("replace_brand_annotations", {"p_user_id": user_id, "p_project_id": project_id,
            "p_annotations": [self.encode(v, user_id=user_id) for v in annotations], "p_expected_version": expected_version}))
        if not rows: raise VersionConflict(project_id)
        raw = rows[0].get("version") if isinstance(rows[0], dict) else rows[0]
        version = int(raw)
        if version != expected_version + 1: raise StoreFailure("Project persistence returned invalid version.")
        return version
    def get_annotations(self, user_id, project_id):
        rows = self._execute(self._client.rpc("get_brand_annotations", {"p_user_id": user_id, "p_project_id": project_id}))
        if not rows: return (0, ())
        generation = rows[0]
        if not isinstance(generation, dict) or generation.get("user_id") != user_id or generation.get("project_id") != project_id:
            raise StoreFailure("Project persistence returned invalid scope.")
        raw_annotations = generation.get("annotations")
        if not isinstance(raw_annotations, list): raise StoreFailure("Project persistence returned invalid annotations.")
        values = tuple(self._validate(CanvasAnnotation, row, user_id, project_id) for row in raw_annotations)
        return (int(generation["version"]), values)

    def store_media(self, user_id, media, content): return self._store_media(user_id, media, content, None)
    def store_media_with_claim(self, user_id, media, content, claim_hash):
        return self._store_media(user_id, media, content, claim_hash)
    def _store_media(self, user_id, media, content, claim_hash):
        raw = bytes(content)
        if (media.owner_id != user_id or len(raw) != media.byte_length
                or not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), media.sha256)
                or (claim_hash is not None and (len(claim_hash) != 64 or any(char not in "0123456789abcdef" for char in claim_hash)))):
            raise InvalidMedia(media.id)
        try: self._client.storage.from_("brand-canvas-media").upload(media.storage_key, bytes(content), {"content-type": media.mime_type})
        except Exception: raise StoreFailure("Project persistence operation failed.") from None
        row = self.encode(media, user_id=user_id); row["claim_hash"] = claim_hash
        row["deletion_pending"] = False
        try:
            rows = self._execute(self._client.table("brand_media").insert(row))
            if not rows: raise StoreFailure("Project persistence operation failed.")
            return self._validate(CanvasMedia, rows[0], user_id, media.project_id, media.id, media.version)
        except Exception:
            try: self._client.storage.from_("brand-canvas-media").remove([media.storage_key])
            except Exception:
                token = secrets.token_urlsafe(32)
                with self._cleanup_lock: self._pending_cleanups[token] = (user_id, media.project_id, media.storage_key)
                raise MediaCleanupFailure(user_id, media.project_id, media.storage_key, token) from None
            raise
    def discard_pending_media(self, user_id, project_id, media_id, claim_hash):
        return self._delete_media_object(user_id, project_id, media_id, 0, claim_hash)
    def read_media(self, user_id, project_id, media_id):
        query = self._client.table("brand_media").select("*").eq("user_id", user_id).eq("project_id", project_id).eq("id", media_id).eq("deletion_pending", False).limit(1)
        rows = self._execute(query)
        media = self._validate(CanvasMedia, rows[0], user_id, project_id, media_id) if rows else None
        if media is None: return None
        try: content = self._client.storage.from_("brand-canvas-media").download(media.storage_key)
        except Exception: raise StoreFailure("Project persistence operation failed.") from None
        return media, bytes(content)
    def delete_media(self, user_id, project_id, media_id, expected_version):
        if not self._delete_media_object(user_id, project_id, media_id, expected_version, None):
            raise GraphItemNotFound(media_id)
    def _delete_media_object(self, user_id, project_id, media_id, expected_version, claim_hash):
        payload = {"p_user_id": user_id, "p_project_id": project_id, "p_media_id": media_id,
                   "p_expected_version": expected_version, "p_claim_hash": claim_hash}
        try:
            result = self._client.rpc("begin_brand_media_deletion", payload).execute()
            key = getattr(result, "data", None)
        except Exception as exc:
            code = getattr(exc, "code", None)
            if claim_hash is not None and code in {"40001", "P2004", "P2005", "P2006"}: return False
            if code == "P2005": raise GraphItemNotFound(media_id) from None
            if code == "P2004": raise InvalidMedia(media_id) from None
            if code == "40001": raise VersionConflict(media_id) from None
            raise StoreFailure("Project persistence operation failed.") from None
        if not isinstance(key, str) or not key: return False
        try: self._client.storage.from_("brand-canvas-media").remove([key])
        except Exception:
            try: self._client.rpc("cancel_brand_media_deletion", {"p_user_id": user_id, "p_project_id": project_id, "p_media_id": media_id}).execute()
            except Exception: pass
            raise StoreFailure("Project persistence operation failed.") from None
        try: self._client.rpc("finalize_brand_media_deletion", {"p_user_id": user_id, "p_project_id": project_id, "p_media_id": media_id}).execute()
        except Exception: raise StoreFailure("Project persistence operation failed.") from None
        return True
    def set_user_theme(self, user_id, theme):
        self._execute(self._client.table("brand_user_preferences").upsert({"user_id": user_id, "theme": theme.value}, on_conflict="user_id"))
    def get_user_theme(self, user_id):
        rows = self._execute(self._client.table("brand_user_preferences").select("theme").eq("user_id", user_id).limit(1))
        return ThemeChoice(rows[0]["theme"]) if rows else ThemeChoice.PAPER
    def set_project_theme(self, user_id, project_id, theme):
        rows = self._execute(self._client.table("brand_projects").update({"theme_override": theme.value if theme else None}).eq("user_id", user_id).eq("id", project_id))
        if not rows: raise ProjectNotFound(project_id)
    def get_project_theme(self, user_id, project_id):
        rows = self._execute(self._client.table("brand_projects").select("theme_override").eq("user_id", user_id).eq("id", project_id).limit(1))
        if not rows: return None
        return ThemeChoice(rows[0]["theme_override"]) if rows[0].get("theme_override") else None

    def retry_media_cleanup(self, user_id: str, project_id: str, failure: MediaCleanupFailure) -> None:
        if not isinstance(failure, MediaCleanupFailure): raise InvalidMedia("cleanup")
        with self._cleanup_lock:
            pending = self._pending_cleanups.get(failure.cleanup_token)
            expected = (failure.user_id, failure.project_id, failure.storage_key)
            if pending != expected or expected != (user_id, project_id, failure.storage_key): raise InvalidMedia("cleanup")
            self._pending_cleanups.pop(failure.cleanup_token)
        key = failure.storage_key
        if not key or "/" in key or "\\" in key or ":" in key: raise InvalidMedia("cleanup")
        try: self._client.storage.from_("brand-canvas-media").remove([key])
        except Exception:
            with self._cleanup_lock: self._pending_cleanups.setdefault(failure.cleanup_token, expected)
            raise MediaCleanupFailure(user_id, project_id, key, failure.cleanup_token) from None


__all__ = ["MediaCleanupFailure", "SupabaseProjectStore"]
