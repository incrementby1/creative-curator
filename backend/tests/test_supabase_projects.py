from __future__ import annotations

import inspect
from dataclasses import replace
import os
import re
import unittest
import threading
from pathlib import Path
from unittest.mock import Mock

from app.persistence.session_store import require_local_supabase_url
from app.projects.store import GraphItemNotFound, InvalidMedia, ProjectStore, StoreFailure, VersionConflict
from app.projects.types import Project


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260726090000_add_spatial_brand_projects.sql"


class MigrationContractTests(unittest.TestCase):
    def test_owner_scoped_rls_tables_and_private_bucket(self) -> None:
        sql = MIGRATION.read_text()
        tables = (
            "brand_projects", "brand_nodes", "brand_edges", "brand_node_revisions",
            "brand_layouts", "brand_media", "brand_annotations", "brand_annotation_sets", "brand_user_preferences",
            "brand_proposals", "brand_analysis_cache", "brand_blueprint_snapshots",
            "brand_challenge_resolutions",
        )
        for table in tables:
            block = re.search(rf"create table public\.{table}\s*\((.*?)\);", sql, re.S | re.I)
            self.assertIsNotNone(block, table)
            self.assertRegex(block.group(1), r"\buser_id\s+uuid\s+not null")
            self.assertRegex(sql, rf"alter table public\.{table} enable row level security")
        self.assertIn("'brand-canvas-media', 'brand-canvas-media', false, 5242880", sql)
        self.assertIn("'image/png', 'image/jpeg', 'image/webp'", sql)
        self.assertNotRegex(sql.lower(), r"create policy")

    def test_atomic_rpcs_are_service_role_only(self) -> None:
        sql = MIGRATION.read_text().lower()
        names = (
            "create_brand_node", "update_brand_node", "delete_brand_node",
            "create_brand_edge", "update_brand_edge", "delete_brand_edge",
            "replace_brand_annotations", "accept_brand_proposal",
            "resolve_brand_challenge",
        )
        for name in names:
            self.assertIn(f"create or replace function public.{name}", sql)
            self.assertIn(f"revoke all on function public.{name}", sql)
            self.assertIn(f"grant execute on function public.{name}", sql)
        self.assertIn("p_expected_project_version bigint", sql)
        self.assertIn("pg_advisory_xact_lock", sql)

    def test_annotation_collection_and_media_lifecycle_are_atomic(self) -> None:
        sql = MIGRATION.read_text().lower()
        self.assertIn("create table public.brand_annotation_sets", sql)
        self.assertIn("p_expected_version bigint", sql)
        self.assertIn("deletion_pending", sql)
        self.assertIn("begin_brand_media_deletion", sql)
        self.assertIn("finalize_brand_media_deletion", sql)
        self.assertIn("cancel_brand_media_deletion", sql)
        self.assertIn("claim_hash = null", sql)
        self.assertIn("brand_annotation_sets enable row level security", sql)
        self.assertIn("m.claim_hash is null", sql)
        self.assertIn("create or replace function public.get_brand_annotations", sql)
        self.assertIn("grant execute on function public.get_brand_annotations", sql)

    def test_layout_first_write_requires_zero_version(self) -> None:
        sql = MIGRATION.read_text().lower()
        self.assertIn("if v is null and p_expected_version<>0", sql)
        self.assertIn("values(p_user_id,p_project_id,p_positions,1)", sql)

    def test_schema_enums_json_shapes_and_helper_privileges_are_bounded(self) -> None:
        sql = MIGRATION.read_text().lower()
        for value in ("'evidence'", "'assumption'", "'idea'", "'decision'", "'challenge'", "'output'",
                      "'working'", "'approved'", "'trash'", "'supports'", "'contradicts'",
                      "'depends_on'", "'inspires'", "'supersedes'", "'user'", "'hermes'", "'import'"):
            self.assertIn(value, sql)
        self.assertIn("jsonb_typeof(positions)='object'", sql)
        self.assertIn("claim_hash is null or claim_hash ~ '^[0-9a-f]{64}$'", sql)
        self.assertIn("sha256 ~ '^[0-9a-f]{64}$'", sql)
        self.assertIn("revoke all on function public.lock_brand_project", sql)
        self.assertIn("grant execute on function public.lock_brand_project", sql)

    def test_rollback_includes_annotation_sets_and_media_rpcs_before_tables(self) -> None:
        rollback = (ROOT / "supabase/manual/rollback_spatial_brand_projects.sql").read_text().lower()
        self.assertIn("drop function if exists public.begin_brand_media_deletion", rollback)
        self.assertIn("drop function if exists public.finalize_brand_media_deletion", rollback)
        self.assertIn("drop table if exists public.brand_annotation_sets", rollback)
        self.assertLess(rollback.index("drop function"), rollback.index("drop table"))


class FakeResult:
    def __init__(self, data): self.data = data


class CodedError(RuntimeError):
    def __init__(self, code): super().__init__("safe structured error"); self.code = code


class FakeQuery:
    def __init__(self, data=None, error: Exception | None = None):
        self.data, self.error, self.filters = data, error, []
    def select(self, *_args, **_kwargs): return self
    def insert(self, *_args, **_kwargs): return self
    def update(self, *_args, **_kwargs): return self
    def delete(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self
    def eq(self, key, value): self.filters.append((key, value)); return self
    def execute(self):
        if self.error: raise self.error
        return FakeResult(self.data)


class FakeClient:
    def __init__(self, query): self.query, self.tables, self.rpcs = query, [], []
    def table(self, name): self.tables.append(name); return self.query
    def rpc(self, name, payload): self.rpcs.append((name, payload)); return self.query


class FakeBucket:
    def __init__(self): self.uploaded, self.removed = [], []
    def upload(self, key, content, options): self.uploaded.append((key, content, options))
    def remove(self, keys): self.removed.extend(keys)
    def download(self, _key): return b"bytes"


class FailingRemoveBucket(FakeBucket):
    def remove(self, keys): super().remove(keys); raise RuntimeError("storage unavailable")


class BlockingBucket(FakeBucket):
    def __init__(self): super().__init__(); self.entered = threading.Event(); self.release = threading.Event()
    def remove(self, keys):
        self.removed.extend(keys); self.entered.set()
        if not self.release.wait(2): raise RuntimeError("timeout")


class FakeStorage:
    def __init__(self, bucket): self.bucket = bucket
    def from_(self, _name): return self.bucket


class RpcClient(FakeClient):
    def __init__(self, scripts):
        super().__init__(FakeQuery([])); self.scripts = {key: list(value) for key, value in scripts.items()}
    def rpc(self, name, payload):
        self.rpcs.append((name, payload)); outcome = self.scripts[name].pop(0)
        return FakeQuery(error=outcome if isinstance(outcome, Exception) else None, data=None if isinstance(outcome, Exception) else outcome)


class SupabaseProjectStoreOfflineTests(unittest.TestCase):
    def test_protocol_is_complete(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        expected = {name for name, value in inspect.getmembers(ProjectStore) if callable(value) and not name.startswith("_")}
        self.assertTrue(expected.issubset(set(dir(SupabaseProjectStore))))

    def test_project_read_scopes_owner_and_project_and_validates_identity(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        project = Project.create("user-a", "Acme")
        row = SupabaseProjectStore.encode(project, user_id="user-a")
        query = FakeQuery([row])
        result = SupabaseProjectStore(FakeClient(query)).get_project("user-a", project.id)
        self.assertEqual(result, project)
        self.assertIn(("user_id", "user-a"), query.filters)
        self.assertIn(("id", project.id), query.filters)

    def test_sdk_exception_is_sanitized(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client = FakeClient(FakeQuery(error=RuntimeError("secret database body")))
        with self.assertRaisesRegex(StoreFailure, "Project persistence operation failed") as caught:
            SupabaseProjectStore(client).list_projects("user-a")
        self.assertNotIn("secret", str(caught.exception))

    def test_atomic_node_creation_uses_named_rpc_and_expected_version(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import CreationSource, GraphNode
        node = GraphNode.create("project-a", "idea", "Name", "Body", CreationSource.USER)
        client = FakeClient(FakeQuery([SupabaseProjectStore.encode(node, user_id="user-a")]))
        SupabaseProjectStore(client).commit_node_creation("user-a", node, 7)
        name, payload = client.rpcs[0]
        self.assertEqual(name, "create_brand_node")
        self.assertEqual(payload["p_user_id"], "user-a")
        self.assertEqual(payload["p_project_id"], "project-a")
        self.assertEqual(payload["p_expected_project_version"], 7)

    def test_proposal_acceptance_sends_complete_atomic_candidate(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import AnalysisProposal, CreationSource, GraphNode
        proposal = replace(AnalysisProposal.create(project_id="project-a", title="Proposal", rationale="Why", target_node_ids=("n",)), state=__import__('app.projects.types', fromlist=['ProposalState']).ProposalState.ACCEPTED, version=2)
        node = GraphNode.create("project-a", "idea", "Name", "Body", CreationSource.HERMES)
        row = SupabaseProjectStore.encode(proposal, user_id="user-a")
        client = FakeClient(FakeQuery([row]))
        SupabaseProjectStore(client).commit_proposal_acceptance("user-a", proposal, (node,), (), 1, 4)
        name, payload = client.rpcs[0]
        self.assertEqual(name, "accept_brand_proposal")
        self.assertEqual(payload["p_expected_proposal_version"], 1)
        self.assertEqual(payload["p_expected_project_version"], 4)
        self.assertEqual(payload["p_proposal"]["id"], proposal.id)
        self.assertEqual(payload["p_nodes"][0]["id"], node.id)
        self.assertEqual(payload["p_edges"], [])
        self.assertEqual(payload["p_proposal"], SupabaseProjectStore.encode(proposal, user_id="user-a"))

    def test_proposal_acceptance_rejects_nonaccepted_candidate_before_rpc(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import AnalysisProposal
        proposal = AnalysisProposal.create(project_id="project-a", title="Proposal", rationale="Why", target_node_ids=("n",))
        client = FakeClient(FakeQuery([]))
        with self.assertRaises(VersionConflict):
            SupabaseProjectStore(client).commit_proposal_acceptance("user-a", proposal, (), (), 1, 4)
        self.assertEqual(client.rpcs, [])

    def test_challenge_resolution_uses_atomic_owner_scoped_rpc(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import ChallengeResolution
        resolution = ChallengeResolution.resolve(project_id="project-a", challenge_id="challenge-a",
            resolution="Accept tradeoff", state="overridden", resolved_by="user-a")
        client = FakeClient(FakeQuery([SupabaseProjectStore.encode(resolution, user_id="user-a")]))
        saved = SupabaseProjectStore(client).commit_challenge_resolution("user-a", resolution, 8)
        self.assertEqual(saved, resolution)
        name, payload = client.rpcs[0]
        self.assertEqual(name, "resolve_brand_challenge")
        self.assertEqual(payload["p_user_id"], "user-a")
        self.assertEqual(payload["p_project_id"], "project-a")
        self.assertEqual(payload["p_expected_project_version"], 8)

    def test_media_insert_failure_removes_uploaded_object(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import CanvasMedia
        content = b"valid bytes"
        digest = __import__('hashlib').sha256(content).hexdigest()
        media = CanvasMedia.create(project_id="project-a", owner_id="user-a", storage_key="opaque", mime_type="image/png", byte_length=len(content), sha256=digest)
        bucket = FakeBucket()
        client = FakeClient(FakeQuery(error=RuntimeError("insert failed")))
        client.storage = FakeStorage(bucket)
        with self.assertRaises(StoreFailure):
            SupabaseProjectStore(client).store_media_with_claim("user-a", media, content, "a" * 64)
        self.assertEqual(bucket.removed, ["opaque"])

    def test_media_empty_insert_result_removes_uploaded_object(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import CanvasMedia
        content = b"valid bytes"
        media = CanvasMedia.create(project_id="project-a", owner_id="user-a", storage_key="opaque", mime_type="image/png", byte_length=len(content), sha256=__import__('hashlib').sha256(content).hexdigest())
        bucket = FakeBucket(); client = FakeClient(FakeQuery([])); client.storage = FakeStorage(bucket)
        with self.assertRaises(StoreFailure):
            SupabaseProjectStore(client).store_media("user-a", media, content)
        self.assertEqual(bucket.removed, ["opaque"])

    def test_media_insert_rejects_wrong_returned_id_and_compensates(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import CanvasMedia
        content=b"valid bytes"; media=CanvasMedia.create(project_id="p",owner_id="u",storage_key="opaque",mime_type="image/png",byte_length=len(content),sha256=__import__('hashlib').sha256(content).hexdigest())
        wrong=SupabaseProjectStore.encode(replace(media,id=str(__import__('uuid').uuid4()),version=2),user_id="u")
        bucket=FakeBucket(); client=FakeClient(FakeQuery([wrong])); client.storage=FakeStorage(bucket)
        with self.assertRaises(StoreFailure): SupabaseProjectStore(client).store_media("u",media,content)
        self.assertEqual(bucket.removed,["opaque"])

    def test_layout_rejects_bool_nonfinite_and_defaults_zero(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client = FakeClient(FakeQuery([])); store = SupabaseProjectStore(client)
        self.assertEqual(store.get_layout("user-a", "project-a"), (0, {}))
        for positions in ({"n": (True, 1)}, {"n": (float("nan"), 1)}, {"": (1, 2)}, {"n": (1,)}):
            with self.assertRaises(ValueError): store.save_layout("user-a", "project-a", positions, 0)

    def test_annotations_default_collection_version_is_zero(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        self.assertEqual(SupabaseProjectStore(FakeClient(FakeQuery([]))).get_annotations("user-a", "project-a"), (0, ()))

    def test_annotations_read_one_coherent_rpc_generation(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client=FakeClient(FakeQuery([{"user_id":"u","project_id":"p","version":3,"annotations":[]}]))
        self.assertEqual(SupabaseProjectStore(client).get_annotations("u","p"),(3,()))
        self.assertEqual(client.rpcs[0][0],"get_brand_annotations")

    def test_direct_updates_reject_version_jump_and_proposal_acceptance(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import AnalysisProposal, ProposalState
        client = FakeClient(FakeQuery([]))
        store = SupabaseProjectStore(client)
        proposal = AnalysisProposal.create(project_id="project-a", title="P", rationale="R", target_node_ids=("n",))
        with self.assertRaises(VersionConflict): store.update_proposal("user-a", replace(proposal, version=3), 1)
        with self.assertRaises(VersionConflict): store.update_proposal("user-a", replace(proposal, state=ProposalState.ACCEPTED, version=2), 1)
        self.assertEqual(client.tables, [])

    def test_finalize_failure_keeps_tombstone_and_retry_finishes(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client = RpcClient({"begin_brand_media_deletion": ["opaque", "opaque"],
                            "finalize_brand_media_deletion": [RuntimeError("offline"), None]})
        bucket = FakeBucket(); client.storage = FakeStorage(bucket)
        with self.assertRaises(StoreFailure): SupabaseProjectStore(client)._delete_media_object("u", "p", "m", 1, None)
        self.assertNotIn("cancel_brand_media_deletion", [name for name, _ in client.rpcs])
        self.assertTrue(SupabaseProjectStore(client)._delete_media_object("u", "p", "m", 1, None))
        self.assertEqual(bucket.removed, ["opaque", "opaque"])

    def test_claim_database_outage_is_not_reported_as_mismatch(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client = RpcClient({"begin_brand_media_deletion": [RuntimeError("offline")]}); client.storage = FakeStorage(FakeBucket())
        with self.assertRaises(StoreFailure): SupabaseProjectStore(client).discard_pending_media("u", "p", "m", "a" * 64)

    def test_media_begin_codes_map_missing_stale_and_referenced(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        cases = (("P2005", GraphItemNotFound), ("40001", VersionConflict), ("P2004", InvalidMedia))
        for code, expected in cases:
            client = RpcClient({"begin_brand_media_deletion": [CodedError(code)]}); client.storage = FakeStorage(FakeBucket())
            with self.assertRaises(expected): SupabaseProjectStore(client).delete_media("u", "p", "m", 1)
        client = RpcClient({"begin_brand_media_deletion": [CodedError("P2006")]}); client.storage = FakeStorage(FakeBucket())
        self.assertFalse(SupabaseProjectStore(client).discard_pending_media("u", "p", "m", "a" * 64))

    def test_rpc_rejects_wrong_item_identity_and_version(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import CreationSource, GraphNode
        node = GraphNode.create("project-a", "idea", "N", "B", CreationSource.USER)
        wrong = SupabaseProjectStore.encode(replace(node, id="wrong", version=2), user_id="user-a")
        with self.assertRaises(StoreFailure): SupabaseProjectStore(FakeClient(FakeQuery([wrong]))).commit_node_creation("user-a", node, 1)

    def test_compensation_failure_exposes_opaque_recovery_key(self) -> None:
        from app.projects.supabase_store import MediaCleanupFailure, SupabaseProjectStore
        from app.projects.types import CanvasMedia
        content = b"valid bytes"; media = CanvasMedia.create(project_id="p", owner_id="u", storage_key="opaque", mime_type="image/png", byte_length=len(content), sha256=__import__('hashlib').sha256(content).hexdigest())
        client = FakeClient(FakeQuery([])); client.storage = FakeStorage(FailingRemoveBucket())
        with self.assertRaises(MediaCleanupFailure) as caught: SupabaseProjectStore(client).store_media("u", media, content)
        self.assertEqual(caught.exception.storage_key, "opaque")

    def test_cleanup_retry_requires_store_issued_capability(self) -> None:
        from app.projects.supabase_store import MediaCleanupFailure, SupabaseProjectStore
        from app.projects.types import CanvasMedia
        content = b"valid bytes"; media = CanvasMedia.create(project_id="p", owner_id="u", storage_key="opaque", mime_type="image/png", byte_length=len(content), sha256=__import__('hashlib').sha256(content).hexdigest())
        failing = FailingRemoveBucket(); client = FakeClient(FakeQuery([])); client.storage = FakeStorage(failing); store = SupabaseProjectStore(client)
        with self.assertRaises(MediaCleanupFailure) as caught: store.store_media("u", media, content)
        forged = MediaCleanupFailure("u", "p", "opaque", "forged")
        with self.assertRaises(InvalidMedia): store.retry_media_cleanup("u", "p", forged)
        with self.assertRaises(InvalidMedia): store.retry_media_cleanup("other", "p", caught.exception)
        with self.assertRaises(InvalidMedia): store.retry_media_cleanup("u", "other", caught.exception)
        with self.assertRaises(MediaCleanupFailure) as retry:
            store.retry_media_cleanup("u", "p", caught.exception)
        self.assertEqual(retry.exception.cleanup_token, caught.exception.cleanup_token)
        healthy = FakeBucket(); client.storage = FakeStorage(healthy)
        store.retry_media_cleanup("u", "p", retry.exception)
        self.assertEqual(healthy.removed, ["opaque"])
        with self.assertRaises(InvalidMedia): store.retry_media_cleanup("u", "p", caught.exception)

    def test_cleanup_capability_is_reserved_during_storage_io(self) -> None:
        from app.projects.supabase_store import MediaCleanupFailure, SupabaseProjectStore
        from app.projects.types import CanvasMedia
        content=b"valid bytes"; media=CanvasMedia.create(project_id="p",owner_id="u",storage_key="opaque",mime_type="image/png",byte_length=len(content),sha256=__import__('hashlib').sha256(content).hexdigest())
        client=FakeClient(FakeQuery([])); client.storage=FakeStorage(FailingRemoveBucket()); store=SupabaseProjectStore(client)
        with self.assertRaises(MediaCleanupFailure) as caught: store.store_media("u",media,content)
        blocking=BlockingBucket(); client.storage=FakeStorage(blocking); errors=[]
        thread=threading.Thread(target=lambda: self._capture_cleanup(store,caught.exception,errors)); thread.start()
        self.assertTrue(blocking.entered.wait(2))
        with self.assertRaises(InvalidMedia): store.retry_media_cleanup("u","p",caught.exception)
        blocking.release.set(); thread.join(2)
        self.assertEqual(errors, []); self.assertEqual(blocking.removed,["opaque"])

    @staticmethod
    def _capture_cleanup(store, failure, errors):
        try: store.retry_media_cleanup("u","p",failure)
        except Exception as exc: errors.append(exc)

    def test_update_project_rejects_owner_mismatch_before_query(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        project = Project.create("user-a", "A"); client = FakeClient(FakeQuery([]))
        with self.assertRaises(__import__('app.projects.store', fromlist=['ProjectNotFound']).ProjectNotFound):
            SupabaseProjectStore(client).update_project("user-b", replace(project, version=2), 1)
        self.assertEqual(client.tables, [])

    def test_direct_node_delete_maps_incident_fk_to_conflict(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        with self.assertRaises(VersionConflict):
            SupabaseProjectStore(FakeClient(FakeQuery(error=CodedError("23503")))).delete_node("u", "p", "n", 1)

    def test_consumed_claim_replay_returns_false(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client = RpcClient({"begin_brand_media_deletion": [CodedError("P2006")]}); client.storage = FakeStorage(FakeBucket())
        self.assertFalse(SupabaseProjectStore(client).discard_pending_media("u", "p", "m", "a" * 64))

    def test_direct_edge_mutations_use_live_endpoint_rpcs(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import GraphEdge
        edge = GraphEdge.create("p", "source", "target", "supports")
        row = SupabaseProjectStore.encode(edge, user_id="u")
        client = FakeClient(FakeQuery([row])); store = SupabaseProjectStore(client)
        store.create_edge("u", edge)
        self.assertEqual(client.rpcs[0][0], "create_brand_edge_direct")
        updated = replace(edge, version=2)
        client.query.data = [SupabaseProjectStore.encode(updated, user_id="u")]
        store.update_edge("u", updated, 1)
        self.assertEqual(client.rpcs[1][0], "update_brand_edge_direct")


class LocalSupabaseProjectIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        values = [os.getenv(name) for name in (
            "SUPABASE_LOCAL_TEST_URL", "SUPABASE_LOCAL_TEST_KEY", "SUPABASE_LOCAL_SERVICE_ROLE_KEY"
        )]
        if not all(values): self.skipTest("explicit local Supabase project variables are required")
        require_local_supabase_url(values[0])
        from supabase import create_client
        from app.projects.supabase_store import SupabaseProjectStore
        self.client = create_client(values[0], values[2])
        self.storage_keys: list[str] = []
        created = self.client.auth.admin.create_user({
            "email": f"project-store-{__import__('uuid').uuid4().hex}@example.test",
            "password": "Local-test-password-8", "email_confirm": True,
        })
        self.user_id = created.user.id
        self.store = SupabaseProjectStore(self.client)

    def tearDown(self) -> None:
        if hasattr(self, "client") and hasattr(self, "user_id"):
            for key in getattr(self, "storage_keys", ()):
                try:
                    self.client.storage.from_("brand-canvas-media").remove([key])
                except Exception:
                    pass
            self.client.auth.admin.delete_user(self.user_id)

    def test_local_project_round_trip_and_owner_isolation(self) -> None:
        from datetime import datetime, timedelta, timezone
        from app.projects.types import (AnnotationType, CanvasAnnotation, CanvasMedia, CreationSource,
                                        GraphEdge, GraphNode, NodeRevision, NodeState)
        project = Project.create(self.user_id, "Local integration project")
        self.assertEqual(self.store.create_project(self.user_id, project), project)
        self.assertEqual(self.store.get_project(self.user_id, project.id), project)
        self.assertIsNone(self.store.get_project(str(__import__('uuid').uuid4()), project.id))
        with self.assertRaises(VersionConflict): self.store.save_layout(self.user_id, project.id, {}, 1)
        self.assertEqual(self.store.save_layout(self.user_id, project.id, {}, 0), 1)
        source = self.store.create_node(self.user_id, GraphNode.create(project.id, "idea", "Source", "Body", CreationSource.USER))
        target = self.store.create_node(self.user_id, GraphNode.create(project.id, "idea", "Target", "Body", CreationSource.USER))
        self.store.update_node(self.user_id, replace(source, state=NodeState.TRASH, version=2), 1)
        with self.assertRaises(GraphItemNotFound):
            self.store.create_edge(self.user_id, GraphEdge.create(project.id, source.id, target.id, "supports"))
        bad_revision = replace(NodeRevision.from_node(target), content="fabricated prior")
        with self.assertRaises(VersionConflict):
            self.store.commit_node_semantic_update(self.user_id, replace(target, content="Next", version=2), bad_revision, 1, 1)

        content = b"local disposable media"
        media = CanvasMedia.create(project_id=project.id, owner_id=self.user_id, storage_key=__import__('uuid').uuid4().hex,
                                   mime_type="image/png", byte_length=len(content), sha256=__import__('hashlib').sha256(content).hexdigest())
        self.storage_keys.append(media.storage_key)
        media = self.store.store_media_with_claim(self.user_id, media, content, "a" * 64)
        freehand = CanvasAnnotation.create(project_id=project.id, owner_id=self.user_id,
                                           annotation_type=AnnotationType.FREEHAND, path_points=((0.0, 0.0), (1.0, 1.0)), color="#000")
        attached = CanvasAnnotation.create_media(project_id=project.id, owner_id=self.user_id, media=media)
        self.assertEqual(self.store.commit_annotations(self.user_id, project.id, (freehand, attached), 0), 1)
        self.assertEqual(self.store.get_annotations(self.user_id, project.id)[0], 1)
        self.assertFalse(self.store.discard_pending_media(self.user_id, project.id, media.id, "a" * 64))
        later = (datetime.fromisoformat(freehand.updated_at) + timedelta(seconds=1)).astimezone(timezone.utc).isoformat()
        changed = replace(freehand, color="#111", version=2, updated_at=later)
        self.assertEqual(self.store.commit_annotations(self.user_id, project.id, (changed, attached), 1), 2)
        self.assertEqual(self.store.commit_annotations(self.user_id, project.id, (), 2), 3)
        self.assertFalse(self.store.discard_pending_media(self.user_id, project.id, media.id, "a" * 64))
        self.assertIsNotNone(self.store.read_media(self.user_id, project.id, media.id))
        self.store.delete_media(self.user_id, project.id, media.id, 1)


if __name__ == "__main__":
    unittest.main()
