from __future__ import annotations

import inspect
import os
import re
import unittest
from pathlib import Path
from unittest.mock import Mock

from app.persistence.session_store import require_local_supabase_url
from app.projects.store import ProjectStore, StoreFailure
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


class FakeStorage:
    def __init__(self, bucket): self.bucket = bucket
    def from_(self, _name): return self.bucket


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
        proposal = AnalysisProposal.create(project_id="project-a", title="Proposal", rationale="Why", target_node_ids=("n",))
        node = GraphNode.create("project-a", "idea", "Name", "Body", CreationSource.HERMES)
        row = SupabaseProjectStore.encode(proposal, user_id="user-a") | {"state": "accepted", "version": 2}
        client = FakeClient(FakeQuery([row]))
        SupabaseProjectStore(client).commit_proposal_acceptance("user-a", proposal, (node,), (), 1, 4)
        name, payload = client.rpcs[0]
        self.assertEqual(name, "accept_brand_proposal")
        self.assertEqual(payload["p_expected_proposal_version"], 1)
        self.assertEqual(payload["p_expected_project_version"], 4)
        self.assertEqual(payload["p_proposal"]["id"], proposal.id)
        self.assertEqual(payload["p_nodes"][0]["id"], node.id)
        self.assertEqual(payload["p_edges"], [])

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
        created = self.client.auth.admin.create_user({
            "email": f"project-store-{__import__('uuid').uuid4().hex}@example.test",
            "password": "Local-test-password-8", "email_confirm": True,
        })
        self.user_id = created.user.id
        self.store = SupabaseProjectStore(self.client)

    def tearDown(self) -> None:
        if hasattr(self, "client") and hasattr(self, "user_id"):
            self.client.auth.admin.delete_user(self.user_id)

    def test_local_project_round_trip_and_owner_isolation(self) -> None:
        project = Project.create(self.user_id, "Local integration project")
        self.assertEqual(self.store.create_project(self.user_id, project), project)
        self.assertEqual(self.store.get_project(self.user_id, project.id), project)
        self.assertIsNone(self.store.get_project(str(__import__('uuid').uuid4()), project.id))


if __name__ == "__main__":
    unittest.main()
