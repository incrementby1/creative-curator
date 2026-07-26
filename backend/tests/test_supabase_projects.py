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
from app.projects.types import NodeState, Project


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
            "brand_analysis_requests",
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
            "promote_brand_branch",
            "create_brand_edge", "update_brand_edge", "delete_brand_edge",
            "replace_brand_annotations", "accept_brand_proposal",
            "resolve_brand_challenge",
            "list_brand_project_summary_inputs",
            "claim_brand_analysis_request", "complete_brand_analysis_request", "abandon_brand_analysis_request",
            "commit_brand_idempotent_mutation",
        )
        for name in names:
            self.assertIn(f"create or replace function public.{name}", sql)
            self.assertIn(f"revoke all on function public.{name}", sql)
            self.assertIn(f"grant execute on function public.{name}", sql)
        self.assertIn("p_expected_project_version bigint", sql)
        self.assertIn("pg_advisory_xact_lock", sql)

    def test_semantic_idempotency_commits_mutation_and_result_in_one_rpc(self) -> None:
        sql = MIGRATION.read_text().lower()
        function = re.search(
            r"create or replace function public\.commit_brand_idempotent_mutation\b(.*?)end \$\$;",
            sql, re.S,
        )
        self.assertIsNotNone(function)
        body = function.group(1)
        for operation in (
            "create_brand_node", "update_brand_node", "delete_brand_node",
            "create_brand_edge", "update_brand_edge", "delete_brand_edge",
            "accept_brand_proposal", "reject_brand_proposal", "resolve_brand_challenge",
            "promote_brand_branch",
        ):
            self.assertIn(f"'{operation}'", body)
        self.assertIn("request_fingerprint<>p_request_fingerprint", body)
        self.assertIn("result=jsonb_build_object('mutation_result',mutation_result)", body)
        self.assertLess(body.index("case p_operation"), body.index("status='completed'"))
        rollback = (ROOT / "supabase/manual/rollback_spatial_brand_projects.sql").read_text().lower()
        self.assertIn("drop function if exists public.commit_brand_idempotent_mutation", rollback)

    def test_analysis_idempotency_and_proposal_immutability_are_database_guarded(self) -> None:
        sql = MIGRATION.read_text().lower()
        self.assertIn("create table public.brand_analysis_requests", sql)
        self.assertIn("request_fingerprint", sql)
        self.assertIn("status text not null check(status in ('pending','completed'))", sql)
        self.assertIn("current_proposal.title is distinct from candidate.title", sql)
        self.assertIn("current_proposal.rationale is distinct from candidate.rationale", sql)
        self.assertIn("current_proposal.target_node_ids is distinct from candidate.target_node_ids", sql)
        self.assertIn("current_proposal.creation_source is distinct from candidate.creation_source", sql)

    def test_proposal_acceptance_guards_canonical_hash_and_dependency_versions(self) -> None:
        sql = MIGRATION.read_text().lower()
        proposal = re.search(r"create table public\.brand_proposals\s*\((.*?)\);", sql, re.S)
        self.assertIsNotNone(proposal)
        self.assertIn("canonical_hash text not null", proposal.group(1))
        self.assertIn("dependency_node_versions jsonb not null", proposal.group(1))
        self.assertIn("dependency_edge_versions jsonb not null", proposal.group(1))
        acceptance = re.search(
            r"create or replace function public\.accept_brand_proposal\b(.*?)\$\$;",
            sql, re.S,
        )
        self.assertIsNotNone(acceptance)
        body = acceptance.group(1)
        self.assertIn("current_proposal.canonical_hash is distinct from candidate.canonical_hash", body)
        self.assertRegex(body, r"brand_nodes.*dependency_node_versions|dependency_node_versions.*brand_nodes")
        self.assertRegex(body, r"brand_edges.*dependency_edge_versions|dependency_edge_versions.*brand_edges")
        self.assertIn("version_conflict", body)

    def test_analysis_claim_has_bounded_lease_and_atomic_expired_takeover(self) -> None:
        sql = MIGRATION.read_text().lower()
        requests = re.search(r"create table public\.brand_analysis_requests\s*\((.*?)\);", sql, re.S)
        self.assertIsNotNone(requests)
        self.assertIn("lease_expires_at timestamptz", requests.group(1))
        claim = re.search(
            r"create or replace function public\.claim_brand_analysis_request\b(.*?)\$\$;",
            sql, re.S,
        )
        self.assertIsNotNone(claim)
        body = claim.group(1)
        self.assertIn("for update", body)
        self.assertRegex(body, r"lease_expires_at\s*<=\s*now\(\)")
        self.assertRegex(body, r"lease_expires_at\s*=\s*now\(\)\s*\+")
        self.assertRegex(body, r"least\s*\(|greatest\s*\(|check\s*\(")

    def test_challenge_acknowledgement_can_precede_one_terminal_record(self) -> None:
        sql = MIGRATION.read_text().lower()
        resolutions = re.search(r"create table public\.brand_challenge_resolutions\s*\((.*?)\);", sql, re.S)
        self.assertIsNotNone(resolutions)
        self.assertIn("'acknowledged'", resolutions.group(1))
        self.assertRegex(sql, r"create unique index brand_challenge_one_acknowledgement_idx.*where state='acknowledged'")
        self.assertRegex(sql, r"create unique index brand_challenge_one_terminal_idx.*where state in \('resolved','deferred','overridden'\)")
        resolver = re.search(
            r"create or replace function public\.resolve_brand_challenge\b(.*?)\$\$;",
            sql, re.S,
        )
        self.assertIsNotNone(resolver)
        self.assertRegex(resolver.group(1), r"resolution_conflict|on conflict")

    def test_foundational_decision_invalidation_is_atomic_and_versioned(self) -> None:
        sql = MIGRATION.read_text().lower()
        updater = re.search(r"create or replace function public\.update_brand_node\b(.*?)\$\$;", sql, re.S)
        self.assertIsNotNone(updater); body = updater.group(1)
        self.assertIn("review_suggested", body)
        self.assertIn("insert into public.brand_node_revisions", body)
        self.assertIn("edge_type in ('supports','inspires')", body)
        self.assertIn("edge_type='depends_on'", body)
        self.assertRegex(body, r"prior\.state='approved'.*prior\.state<>x\.state")
        self.assertRegex(body, r"prior\.node_type='decision'.*prior\.node_type<>x\.node_type")

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
        self.assertIn("values(p_user_id,p_project_id,p_positions,p_dimensions,1)", sql)
        self.assertIn("dimensions jsonb not null default '{}'", sql)

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

    def test_blueprint_snapshots_persist_canonical_versioned_identity(self) -> None:
        sql = MIGRATION.read_text().lower()
        self.assertIn("project_version bigint not null check(project_version>0)", sql)
        self.assertIn("sequence bigint not null check(sequence>0)", sql)
        self.assertIn("canonical_json text not null", sql)
        self.assertIn("project_title text not null", sql)
        self.assertIn("unique(user_id,project_id,project_version)", sql)
        self.assertIn("unique(user_id,project_id,sequence)", sql)
        self.assertIn("create or replace function public.create_brand_blueprint_snapshot", sql)
        self.assertRegex(sql, r"(?s)create or replace function public.create_brand_blueprint_snapshot.*?for update")
        self.assertIn("revoke all on function public.create_brand_blueprint_snapshot", sql)
        self.assertIn("grant execute on function public.create_brand_blueprint_snapshot", sql)
        function = re.search(
            r"create or replace function public.create_brand_blueprint_snapshot.*?end \$\$;",
            sql, re.S,
        ).group(0)
        self.assertIn("canonical_json::jsonb->>'project_title'", function)
        self.assertLess(function.index("current_version<>p_expected_project_version"),
                        function.index("select * into existing"))
        rollback = (ROOT / "supabase/manual/rollback_spatial_brand_projects.sql").read_text().lower()
        self.assertIn("drop function if exists public.create_brand_blueprint_snapshot", rollback)

    def test_rollback_includes_annotation_sets_and_media_rpcs_before_tables(self) -> None:
        rollback = (ROOT / "supabase/manual/rollback_spatial_brand_projects.sql").read_text().lower()
        self.assertIn("drop function if exists public.begin_brand_media_deletion", rollback)
        self.assertIn("drop function if exists public.finalize_brand_media_deletion", rollback)
        self.assertIn("drop table if exists public.brand_annotation_sets", rollback)
        first_table = rollback.index("drop table")
        function_positions = [match.start() for match in re.finditer(r"drop function", rollback)]
        self.assertTrue(function_positions)
        self.assertTrue(all(position < first_table for position in function_positions))
        self.assertLess(rollback.index("drop function if exists public.commit_brand_idempotent_mutation"), first_table)


class FakeResult:
    def __init__(self, data): self.data = data


class CodedError(RuntimeError):
    def __init__(self, code): super().__init__("safe structured error"); self.code = code


class FakeQuery:
    def __init__(self, data=None, error: Exception | None = None):
        self.data, self.error, self.filters, self.limits = data, error, [], []
    def select(self, *_args, **_kwargs): return self
    def insert(self, *_args, **_kwargs): return self
    def update(self, *_args, **_kwargs): return self
    def delete(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, value, *_args, **_kwargs): self.limits.append(value); return self
    def eq(self, key, value): self.filters.append((key, value)); return self
    def in_(self, key, value): self.filters.append((key, tuple(value))); return self
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
    def test_project_summary_inputs_use_one_bounded_transactional_rpc(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore

        project = Project.create("user-a", "Brand")
        project_row = SupabaseProjectStore.encode(project, user_id="user-a")
        client = RpcClient({"list_brand_project_summary_inputs": [[{
            "summary": {"project": project_row, "nodes": [], "resolutions": []},
        }]]})
        projects, nodes, resolutions = SupabaseProjectStore(client).list_project_summary_inputs("user-a", 25)
        self.assertEqual(projects, (project,))
        self.assertEqual(nodes, ())
        self.assertEqual(resolutions, ())
        self.assertEqual(client.rpcs, [("list_brand_project_summary_inputs", {
            "p_user_id": "user-a", "p_limit": 25,
        })])

    def test_project_summary_rpc_rejects_wrong_scope_order_and_shape(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore

        first = Project.create("user-a", "First")
        wrong = Project.create("user-b", "Wrong")
        cases = (
            [{"summary": {"project": SupabaseProjectStore.encode(wrong, user_id="user-b"), "nodes": [], "resolutions": []}}],
            [{"summary": {"project": SupabaseProjectStore.encode(first, user_id="user-a"), "nodes": {}}}],
        )
        for rows in cases:
            with self.subTest(rows=rows):
                client = RpcClient({"list_brand_project_summary_inputs": [rows]})
                with self.assertRaises(StoreFailure):
                    SupabaseProjectStore(client).list_project_summary_inputs("user-a", 25)

    def test_project_summary_rpc_contract_is_locked_bounded_and_rollback_safe(self) -> None:
        sql = MIGRATION.read_text().lower()
        function = re.search(
            r"create or replace function public\.list_brand_project_summary_inputs\b(.*?)end \$\$;",
            sql, re.S,
        )
        self.assertIsNotNone(function)
        body = function.group(1)
        self.assertIn("p_limit<1 or p_limit>100", body)
        self.assertIn("for share", body)
        self.assertIn("order by p.id limit p_limit", body)
        self.assertIn("jsonb_agg(to_jsonb(n) order by n.id)", body)
        self.assertIn("brand_challenge_resolutions", body)
        self.assertNotIn("brand_edges", body)
        rollback = (ROOT / "supabase/manual/rollback_spatial_brand_projects.sql").read_text().lower()
        self.assertIn("drop function if exists public.list_brand_project_summary_inputs(uuid,integer)", rollback)

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

    def test_blueprint_snapshot_codec_preserves_canonical_payload_and_versions(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import BlueprintSnapshot
        snapshot = BlueprintSnapshot.create_compiled(
            project_id="project-a", project_version=7, sequence=3,
            project_title="Acme original", canonical_json='{"project_title":"Acme original","sections":{}}', node_ids=("n",), edge_ids=("e",),
            readiness_warnings=("purpose: approved decision required",),
            unresolved_assumption_ids=("a",),
        )
        row = SupabaseProjectStore.encode(snapshot, user_id="user-a")
        self.assertEqual(SupabaseProjectStore._decode(BlueprintSnapshot, row), snapshot)
        self.assertEqual(row["project_title"], "Acme original")

    def test_branch_promotion_uses_one_atomic_rpc_with_exact_candidates(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import GraphNode
        first = replace(GraphNode.create("project-a", "decision", "First", "One", "user", tags=("branch:bold",)), state=NodeState.APPROVED, version=2)
        second = replace(GraphNode.create("project-a", "decision", "Second", "Two", "user", tags=("branch:bold",)), state=NodeState.APPROVED, version=2)
        rows = [SupabaseProjectStore.encode(node, user_id="user-a") for node in (first, second)]
        client = FakeClient(FakeQuery(rows)); result = SupabaseProjectStore(client).promote_branch(
            "user-a", "project-a", "bold", 7, {second.id: 1, first.id: 1},
        )
        self.assertEqual({node.id for node in result}, {first.id, second.id})
        self.assertEqual(client.rpcs[0][0], "promote_brand_branch")
        self.assertEqual(client.rpcs[0][1]["p_expected_project_version"], 7)
        self.assertEqual([item["node_id"] for item in client.rpcs[0][1]["p_candidates"]], sorted([first.id, second.id]))

    def test_branch_promotion_rejects_corrupt_rpc_candidate_rows(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import GraphNode
        first = replace(GraphNode.create("project-a", "decision", "First", "One", "user", tags=("branch:bold",)), state=NodeState.APPROVED, version=2)
        second = replace(GraphNode.create("project-a", "decision", "Second", "Two", "user", tags=("branch:bold",)), state=NodeState.APPROVED, version=4)
        good = [SupabaseProjectStore.encode(node, user_id="user-a") for node in (first, second)]
        corruptions = {
            "wrong_ids_same_count": [{**good[0], "id": str(__import__("uuid").uuid4())}, good[1]],
            "duplicate": [good[0], good[0]],
            "wrong_version": [{**good[0], "version": 8}, good[1]],
            "wrong_state": [{**good[0], "state": "working"}, good[1]],
            "wrong_type": [{**good[0], "node_type": "idea"}, good[1]],
            "missing_branch": [{**good[0], "tags": ["branch:calm"]}, good[1]],
            "wrong_owner": [{**good[0], "user_id": "user-b"}, good[1]],
            "wrong_project": [{**good[0], "project_id": "project-b"}, good[1]],
        }
        candidates = {first.id: 1, second.id: 3}
        for label, rows in corruptions.items():
            with self.subTest(corruption=label), self.assertRaises(StoreFailure):
                SupabaseProjectStore(FakeClient(FakeQuery(rows))).promote_branch(
                    "user-a", "project-a", "bold", 7, candidates,
                )

    def test_blueprint_snapshot_uses_atomic_expected_project_version_rpc(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import BlueprintSnapshot
        snapshot = BlueprintSnapshot.create_compiled(
            project_id="project-a", project_version=7, sequence=3,
            project_title="Acme original", canonical_json='{"project_title":"Acme original","sections":{}}', node_ids=("n",), edge_ids=("e",),
            readiness_warnings=("warning",), unresolved_assumption_ids=("a",),
        )
        row = SupabaseProjectStore.encode(snapshot, user_id="user-a")
        client = FakeClient(FakeQuery([row]))
        result = SupabaseProjectStore(client).create_snapshot("user-a", snapshot, 7)
        self.assertEqual(result, snapshot)
        self.assertEqual(client.rpcs, [("create_brand_blueprint_snapshot", {
            "p_user_id": "user-a", "p_project_id": "project-a",
            "p_snapshot": row, "p_expected_project_version": 7,
        })])

    def test_blueprint_snapshot_accepts_exact_concurrent_winner_sequence(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import BlueprintSnapshot
        candidate = BlueprintSnapshot.create_compiled(
            project_id="project-a", project_version=7, sequence=3,
            project_title="Acme original", canonical_json='{"project_title":"Acme original","sections":{}}', node_ids=("n",), edge_ids=("e",),
            readiness_warnings=("warning",), unresolved_assumption_ids=("a",),
        )
        winner = replace(candidate, id=str(__import__('uuid').uuid4()), sequence=4,
                         name="Starter Brand Blueprint 4")
        row = SupabaseProjectStore.encode(winner, user_id="user-a")
        result = SupabaseProjectStore(FakeClient(FakeQuery([row]))).create_snapshot(
            "user-a", candidate, 7,
        )
        self.assertEqual(result, winner)

    def test_blueprint_snapshot_rejects_wrong_rpc_scope_version_or_payload(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import BlueprintSnapshot
        snapshot = BlueprintSnapshot.create_compiled(
            project_id="project-a", project_version=7, sequence=3,
            project_title="Acme original", canonical_json='{"project_title":"Acme original","sections":{}}', node_ids=("n",), edge_ids=("e",),
            readiness_warnings=("warning",), unresolved_assumption_ids=("a",),
        )
        base = SupabaseProjectStore.encode(snapshot, user_id="user-a")
        corruptions = (
            {**base, "user_id": "user-b"}, {**base, "project_version": 8},
            {**base, "canonical_json": '{"sections":{"tampered":{}}}'},
            {**base, "project_title": "Tampered"},
        )
        for row in corruptions:
            with self.subTest(row=row):
                with self.assertRaises(StoreFailure):
                    SupabaseProjectStore(FakeClient(FakeQuery([row]))).create_snapshot(
                        "user-a", snapshot, 7,
                    )

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

    def test_idempotent_semantic_commit_uses_single_transactional_dispatch_rpc(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import CreationSource, GraphNode
        node = GraphNode.create("project-a", "idea", "Name", "Body", CreationSource.USER)
        row = SupabaseProjectStore.encode(node, user_id="user-a")
        client = FakeClient(FakeQuery([{"replayed": False, "mutation_result": row}]))
        store = SupabaseProjectStore(client)
        saved = store.commit_idempotent_mutation(
            "user-a", "project-a", "queued-operation-1", "a" * 64,
            lambda: store.commit_node_creation("user-a", node, 7),
        )
        self.assertEqual(saved, node)
        self.assertEqual(len(client.rpcs), 1)
        name, payload = client.rpcs[0]
        self.assertEqual(name, "commit_brand_idempotent_mutation")
        self.assertEqual(payload["p_operation"], "create_brand_node")
        self.assertEqual(payload["p_arguments"]["p_expected_project_version"], 7)
        self.assertEqual(payload["p_idempotency_key"], "queued-operation-1")

    def test_proposal_acceptance_sends_complete_atomic_candidate(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import AnalysisProposal, CreationSource, GraphNode
        proposal = replace(AnalysisProposal.create(project_id="project-a", title="Proposal", rationale="Why", target_node_ids=("n",)), state=__import__('app.projects.types', fromlist=['ProposalState']).ProposalState.ACCEPTED, version=2)
        node = replace(GraphNode.create("project-a", "challenge", "Name", "Body", CreationSource.HERMES),
                       challenge_dependencies=("canonical-node-id",), challenge_confidence=73,
                       challenge_downstream_effect="Positioning changes")
        row = SupabaseProjectStore.encode(proposal, user_id="user-a")
        client = FakeClient(FakeQuery([row]))
        SupabaseProjectStore(client).commit_proposal_acceptance("user-a", proposal, (node,), (), 1, 4)
        name, payload = client.rpcs[0]
        self.assertEqual(name, "accept_brand_proposal")
        self.assertEqual(payload["p_expected_proposal_version"], 1)
        self.assertEqual(payload["p_expected_project_version"], 4)
        self.assertEqual(payload["p_proposal"]["id"], proposal.id)
        self.assertEqual(payload["p_nodes"][0]["id"], node.id)
        self.assertEqual(payload["p_nodes"][0]["challenge_dependencies"], ["canonical-node-id"])
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

    def test_analysis_idempotency_uses_hashed_atomic_rpc_claims(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client = FakeClient(FakeQuery([{"status": "claimed"}]))
        store = SupabaseProjectStore(client)
        self.assertIsNone(store.claim_analysis_request("user-a", "project-a", "request-key",
            "a" * 64, "raw-claim-token"))
        name, payload = client.rpcs[0]
        self.assertEqual(name, "claim_brand_analysis_request")
        self.assertNotEqual(payload["p_claim_hash"], "raw-claim-token")
        self.assertNotIn("raw-claim-token", repr(payload))

        client.query.data = [{"status": "completed", "result": {"proposal": {}, "candidate": {}}}]
        self.assertEqual(store.claim_analysis_request("user-a", "project-a", "request-key",
            "a" * 64, "other-token"), {"proposal": {}, "candidate": {}})

    def test_completed_supabase_replay_rejects_corrupt_binding_and_project(self) -> None:
        from dataclasses import asdict
        from app.llm.schemas import GraphAnalysisOutput
        from app.projects.analysis import GraphAnalysisService
        from app.projects.supabase_store import SupabaseProjectStore
        from app.projects.types import AnalysisProposal
        output = GraphAnalysisOutput.model_validate({
            "summary": "Bound", "proposed_nodes": (), "proposed_edges": (),
            "affected_node_ids": ("node-a",),
        }, strict=True)
        node_versions = {"node-a": 1}
        proposal = AnalysisProposal.create(
            project_id="project-a", title="Bound", rationale="Bound",
            target_node_ids=("node-a",),
            canonical_hash=GraphAnalysisService._candidate_hash(output, node_versions, {}),
            dependency_node_versions=node_versions,
        )
        proposal_value = asdict(proposal)
        proposal_value["creation_source"] = proposal.creation_source.value
        proposal_value["state"] = proposal.state.value
        base = {"proposal": proposal_value, "candidate": output.model_dump(mode="json")}
        for field in ("summary", "dependencies", "project", "targets"):
            result = __import__('copy').deepcopy(base)
            if field == "summary": result["candidate"]["summary"] = "Tampered"
            elif field == "dependencies": result["proposal"]["dependency_node_versions"] = ()
            elif field == "project": result["proposal"]["project_id"] = "other-project"
            else: result["proposal"]["target_node_ids"] = ("other-node",)
            client = RpcClient({"claim_brand_analysis_request": [{
                "status": "completed", "result": result,
            }]})
            service = GraphAnalysisService(SupabaseProjectStore(client), Mock(), Mock())
            with self.subTest(field=field), self.assertRaises(StoreFailure):
                service.analyze("user-a", "project-a", "node-a", "challenge", 1,
                                f"supabase-replay-{field}")

    def test_analysis_idempotency_conflicts_are_typed(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        for code in ("P2201", "P2202"):
            with self.subTest(code=code), self.assertRaises(VersionConflict):
                SupabaseProjectStore(FakeClient(FakeQuery(error=CodedError(code)))).claim_analysis_request(
                    "user-a", "project-a", "request-key", "a" * 64, "claim-token")

        with self.assertRaises(VersionConflict):
            SupabaseProjectStore(FakeClient(FakeQuery(error=CodedError("P2203")))).complete_analysis_request(
                "user-a", "project-a", "request-key", "claim-token", {"safe": True})

    def test_analysis_completion_validates_exact_identity_and_result(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        expected = {"proposal": {"id": "p"}, "candidate": {"summary": "safe"}}
        response = {"completed": True, "user_id": "user-a", "project_id": "project-a",
                    "idempotency_key": "request-key", "result": expected}
        client = FakeClient(FakeQuery([response])); store = SupabaseProjectStore(client)
        store.complete_analysis_request("user-a", "project-a", "request-key", "raw-token", expected)
        name, payload = client.rpcs[0]
        self.assertEqual(name, "complete_brand_analysis_request")
        self.assertEqual(payload["p_result"], expected)
        self.assertNotEqual(payload["p_claim_hash"], "raw-token")
        self.assertNotIn("raw-token", repr(payload))
        for field, value in (("user_id", "other"), ("project_id", "other"),
                             ("idempotency_key", "other"), ("result", {"wrong": True})):
            bad = {**response, field: value}
            with self.subTest(field=field), self.assertRaises(StoreFailure):
                SupabaseProjectStore(FakeClient(FakeQuery([bad]))).complete_analysis_request(
                    "user-a", "project-a", "request-key", "raw-token", expected)

    def test_analysis_abandon_hashes_capability(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client = FakeClient(FakeQuery([]))
        SupabaseProjectStore(client).abandon_analysis_request(
            "user-a", "project-a", "request-key", "raw-token")
        name, payload = client.rpcs[0]
        self.assertEqual(name, "abandon_brand_analysis_request")
        self.assertNotEqual(payload["p_claim_hash"], "raw-token")
        self.assertNotIn("raw-token", repr(payload))

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

    def test_layout_dimensions_are_validated_and_sent_to_rpc(self) -> None:
        from app.projects.supabase_store import SupabaseProjectStore
        client = FakeClient(FakeQuery([{"version": 1}]))
        store = SupabaseProjectStore(client)
        self.assertEqual(store.save_layout("user-a", "project-a", {"node-a": (1, 2)}, 0,
                                           dimensions={"node-a": (240, 144)}), 1)
        self.assertEqual(client.rpcs[-1][1]["p_dimensions"], {"node-a": (240.0, 144.0)})
        for dimensions in ({"node-a": (79, 100)}, {"node-a": (100, True)}, {"node-a": (100, float("nan"))}):
            with self.assertRaises(ValueError):
                store.save_layout("user-a", "project-a", {"node-a": (1, 2)}, 1, dimensions=dimensions)

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
                                        GraphEdge, GraphNode, NodeRevision, NodeState, NodeType)
        project = Project.create(self.user_id, "Local integration project")
        self.assertEqual(self.store.create_project(self.user_id, project), project)
        self.assertEqual(self.store.get_project(self.user_id, project.id), project)
        self.assertIsNone(self.store.get_project(str(__import__('uuid').uuid4()), project.id))
        with self.assertRaises(VersionConflict): self.store.save_layout(self.user_id, project.id, {}, 1)
        self.assertEqual(self.store.save_layout(self.user_id, project.id, {}, 0), 1)
        source = self.store.create_node(self.user_id, GraphNode.create(project.id, "idea", "Source", "Body", CreationSource.USER))
        target = self.store.create_node(self.user_id, GraphNode.create(project.id, "idea", "Target", "Body", CreationSource.USER))
        summary_projects, summary_nodes, summary_resolutions = self.store.list_project_summary_inputs(self.user_id, 100)
        self.assertIn(project, summary_projects)
        self.assertEqual({source.id, target.id}, {node.id for node in summary_nodes if node.project_id == project.id})
        self.assertEqual(summary_resolutions, ())
        foreign_id = str(__import__('uuid').uuid4())
        self.assertEqual(self.store.list_project_summary_inputs(foreign_id, 100), ((), (), ()))
        self.store.update_node(self.user_id, replace(source, state=NodeState.TRASH, version=2), 1)
        with self.assertRaises(GraphItemNotFound):
            self.store.create_edge(self.user_id, GraphEdge.create(project.id, source.id, target.id, "supports"))
        bad_revision = replace(NodeRevision.from_node(target), content="fabricated prior")
        with self.assertRaises(VersionConflict):
            self.store.commit_node_semantic_update(self.user_id, replace(target, content="Next", version=2), bad_revision, 1, 1)
        current_project = self.store.get_project(self.user_id, project.id)
        assert current_project is not None
        structured = replace(
            target, node_type=NodeType.CHALLENGE, content="Structured concern", version=2,
            challenge_dependencies=(source.id,), challenge_confidence=82,
            challenge_downstream_effect="Positioning may change",
        )
        saved_structured = self.store.commit_node_semantic_update(
            self.user_id, structured, NodeRevision.from_node(target), 1, current_project.version,
        )
        self.assertEqual(
            (saved_structured.challenge_dependencies, saved_structured.challenge_confidence,
             saved_structured.challenge_downstream_effect),
            ((source.id,), 82, "Positioning may change"),
        )
        prior_revision, = self.store.list_revisions(self.user_id, project.id, target.id)
        self.assertEqual((prior_revision.node_version, prior_revision.challenge_dependencies), (1, ()))

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

    def test_failed_analysis_claim_can_be_abandoned_and_reclaimed(self) -> None:
        project = Project.create(self.user_id, "Analysis idempotency integration")
        self.store.create_project(self.user_id, project)
        self.assertIsNone(self.store.claim_analysis_request(
            self.user_id, project.id, "retryable-analysis-key", "a" * 64, "first-claim"))
        self.store.abandon_analysis_request(
            self.user_id, project.id, "retryable-analysis-key", "first-claim")
        self.assertIsNone(self.store.claim_analysis_request(
            self.user_id, project.id, "retryable-analysis-key", "a" * 64, "second-claim"))
        result = {"proposal": {"id": "safe"}, "candidate": {"summary": "safe"}}
        self.store.complete_analysis_request(
            self.user_id, project.id, "retryable-analysis-key", "second-claim", result)
        self.assertEqual(self.store.claim_analysis_request(
            self.user_id, project.id, "retryable-analysis-key", "a" * 64, "third-claim"), result)

    def test_expired_analysis_claim_is_atomically_taken_over(self) -> None:
        from datetime import datetime, timedelta, timezone
        project = Project.create(self.user_id, "Analysis lease takeover")
        self.store.create_project(self.user_id, project)
        self.assertIsNone(self.store.claim_analysis_request(
            self.user_id, project.id, "leased-analysis-key", "a" * 64, "first-claim"))
        expired = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        self.client.table("brand_analysis_requests").update({"lease_expires_at": expired}).eq(
            "user_id", self.user_id).eq("project_id", project.id).eq(
            "idempotency_key", "leased-analysis-key").execute()
        self.assertIsNone(self.store.claim_analysis_request(
            self.user_id, project.id, "leased-analysis-key", "a" * 64, "second-claim"))
        with self.assertRaises(VersionConflict):
            self.store.complete_analysis_request(
                self.user_id, project.id, "leased-analysis-key", "first-claim", {"stale": True})
        result = {"proposal": {"id": "winner"}, "candidate": {"summary": "safe"}}
        self.store.complete_analysis_request(
            self.user_id, project.id, "leased-analysis-key", "second-claim", result)
        self.assertEqual(self.store.claim_analysis_request(
            self.user_id, project.id, "leased-analysis-key", "a" * 64, "third-claim"), result)

    def test_proposal_acceptance_rejects_stale_node_and_edge_dependencies(self) -> None:
        from app.projects.types import AnalysisProposal, CreationSource, GraphEdge, GraphNode, ProposalState
        for dependency_kind in ("node", "edge"):
            with self.subTest(dependency_kind=dependency_kind):
                project = Project.create(self.user_id, f"Stale {dependency_kind} dependency")
                self.store.create_project(self.user_id, project)
                source = self.store.create_node(self.user_id, GraphNode.create(
                    project.id, "idea", "Source", "Body", CreationSource.USER))
                target = self.store.create_node(self.user_id, GraphNode.create(
                    project.id, "evidence", "Target", "Body", CreationSource.USER))
                edge = self.store.create_edge(self.user_id, GraphEdge.create(
                    project.id, source.id, target.id, "supports"))
                proposal = AnalysisProposal.create(
                    project_id=project.id, title="Bound", rationale="Bound candidate",
                    target_node_ids=(source.id,), canonical_hash="b" * 64,
                    dependency_node_versions={source.id: source.version},
                    dependency_edge_versions={edge.id: edge.version},
                )
                self.store.create_proposal(self.user_id, proposal)
                if dependency_kind == "node":
                    self.store.update_node(self.user_id, replace(source, content="Changed", version=2), 1)
                else:
                    self.store.update_edge(self.user_id, replace(edge, label="Changed", version=2), 1)
                with self.assertRaises(VersionConflict):
                    self.store.commit_proposal_acceptance(
                        self.user_id, replace(proposal, state=ProposalState.ACCEPTED, version=2),
                        (), (), 1, project.version,
                    )

    def test_challenge_can_have_only_one_terminal_resolution(self) -> None:
        from app.projects.types import ChallengeResolution, CreationSource, GraphNode
        project = Project.create(self.user_id, "Terminal challenge")
        self.store.create_project(self.user_id, project)
        challenge = self.store.create_node(self.user_id, GraphNode.create(
            project.id, "challenge", "Prove it", "Evidence required", CreationSource.HERMES))
        first = ChallengeResolution.resolve(
            project_id=project.id, challenge_id=challenge.id, resolution="Deferred deliberately",
            state="deferred", resolved_by=self.user_id)
        self.store.commit_challenge_resolution(self.user_id, first, 1)
        second = ChallengeResolution.resolve(
            project_id=project.id, challenge_id=challenge.id, resolution="Override later",
            state="overridden", resolved_by=self.user_id)
        with self.assertRaises(VersionConflict):
            self.store.commit_challenge_resolution(self.user_id, second, 2)


if __name__ == "__main__":
    unittest.main()
