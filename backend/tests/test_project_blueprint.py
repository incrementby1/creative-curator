from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
import unittest
from uuid import uuid4

from app.projects.blueprint import BlueprintCompiler, REQUIRED_BLUEPRINT_SECTIONS
from app.projects.store import InMemoryProjectStore, ProjectNotFound, StoreFailure, VersionConflict
from app.projects.types import (
    ChallengeResolution, ChallengeState, CreationSource, GraphNode, NodeState,
    NodeType, Project,
)


class BlueprintCompilerTests(unittest.TestCase):
    def test_failed_request_retries_exact_captured_candidate_after_graph_advances(self) -> None:
        class FailingOnceStore(InMemoryProjectStore):
            fail = True
            def finalize_blueprint_request(self, user_id, project_id, request_id):
                if self.fail:
                    self.fail = False
                    raise StoreFailure("lost response")
                return super().finalize_blueprint_request(user_id, project_id, request_id)

        store = FailingOnceStore()
        project = store.create_project("user-a", Project.create("user-a", "Captured"))
        compiler = BlueprintCompiler(store)
        request_id = str(uuid4())
        with self.assertRaises(StoreFailure):
            compiler.compile("user-a", project.id, expected_project_version=1, request_id=request_id)
        store.commit_node_creation(
            "user-a", GraphNode.create(project.id, NodeType.IDEA, "Later", "Must not enter old candidate", CreationSource.USER), 1,
        )
        snapshot = compiler.compile("user-a", project.id, expected_project_version=1, request_id=request_id)
        self.assertEqual(snapshot.project_version, 1)
        self.assertNotIn("Must not enter old candidate", snapshot.canonical_json)
        with self.assertRaises(ProjectNotFound):
            compiler.compile("user-b", project.id, expected_project_version=1, request_id=request_id)

    def test_pending_compilation_request_expires_after_bounded_window(self) -> None:
        now = datetime(2026, 7, 27, tzinfo=timezone.utc)
        store = InMemoryProjectStore(clock=lambda: now)
        project = store.create_project("user-a", Project.create("user-a", "Expiry"))
        compiler = BlueprintCompiler(store)
        request_id = str(uuid4())
        original_finalize = store.finalize_blueprint_request
        store.finalize_blueprint_request = lambda *_: (_ for _ in ()).throw(StoreFailure("offline"))
        with self.assertRaises(StoreFailure):
            compiler.compile("user-a", project.id, expected_project_version=1, request_id=request_id)
        now += timedelta(hours=24, seconds=1)
        self.assertIsNone(store.get_blueprint_request("user-a", project.id, request_id))
        store.finalize_blueprint_request = original_finalize
    def setUp(self) -> None:
        self.store = InMemoryProjectStore()
        self.project = self.store.create_project("user-a", Project.create("user-a", "Northstar"))
        self.compiler = BlueprintCompiler(self.store)

    def node(self, node_id: str, node_type: NodeType, section: str, *,
             state: NodeState = NodeState.WORKING, content: str | None = None,
             extra_tags: tuple[str, ...] = ()) -> GraphNode:
        node = GraphNode.create(
            self.project.id, node_type, node_id, content or f"Content for {node_id}",
            CreationSource.USER, tags=(f"section:{section}", *extra_tags),
        )
        node = replace(node, id=node_id, state=state)
        self.store.create_node("user-a", node)
        return node

    def test_readiness_requires_approved_decision_and_no_blocking_challenge(self) -> None:
        decision = self.node("purpose-decision", NodeType.DECISION, "purpose", state=NodeState.APPROVED)
        challenge = self.node("purpose-challenge", NodeType.CHALLENGE, "purpose")
        readiness = self.compiler.readiness("user-a", self.project.id)
        self.assertFalse(readiness.sections["purpose"].ready)
        self.assertEqual(readiness.sections["purpose"].approved_decision_ids, (decision.id,))
        self.assertEqual(readiness.sections["purpose"].blocking_challenge_ids, (challenge.id,))
        resolution = ChallengeResolution.resolve(
            project_id=self.project.id, challenge_id=challenge.id, resolution="Accepted tradeoff",
            state=ChallengeState.RESOLVED, resolved_by="user-a",
        )
        self.store.commit_challenge_resolution("user-a", resolution, self.project.version)
        self.assertTrue(self.compiler.readiness("user-a", self.project.id).sections["purpose"].ready)

    def test_blueprint_exposes_assumptions_sources_and_deterministic_sections(self) -> None:
        self.node("audience-evidence", NodeType.EVIDENCE, "audience")
        self.node("audience-assumption", NodeType.ASSUMPTION, "audience")
        self.node("audience-decision", NodeType.DECISION, "audience", state=NodeState.APPROVED)
        snapshot = self.compiler.compile("user-a", self.project.id, expected_project_version=1)
        audience = snapshot.sections["audience"]
        self.assertEqual(audience.source_node_ids,
                         ("audience-assumption", "audience-decision", "audience-evidence"))
        self.assertEqual(snapshot.unresolved_assumption_ids, ("audience-assumption",))
        self.assertEqual(tuple(snapshot.sections), REQUIRED_BLUEPRINT_SECTIONS)
        self.assertEqual(json.dumps(json.loads(snapshot.canonical_json), sort_keys=True,
                                    separators=(",", ":")), snapshot.canonical_json)

    def test_early_generation_warns_and_same_version_is_idempotent(self) -> None:
        first = self.compiler.compile("user-a", self.project.id, expected_project_version=1)
        second = self.compiler.compile("user-a", self.project.id, expected_project_version=1)
        self.assertEqual(first, second)
        self.assertEqual(first.sequence, 1)
        self.assertEqual(len(first.readiness_warnings), len(REQUIRED_BLUEPRINT_SECTIONS))

    def test_historical_snapshot_is_immutable_after_graph_change(self) -> None:
        first = self.compiler.compile("user-a", self.project.id, expected_project_version=1)
        self.store.commit_node_creation(
            "user-a", replace(GraphNode.create(
                self.project.id, NodeType.DECISION, "Purpose", "Changed later",
                CreationSource.USER, tags=("purpose",),
            ), state=NodeState.APPROVED), 1,
        )
        second = self.compiler.compile("user-a", self.project.id, expected_project_version=2)
        self.assertEqual(first.sequence, 1)
        self.assertEqual(second.sequence, 2)
        self.assertNotEqual(first.canonical_json, second.canonical_json)
        self.assertEqual(self.store.get_snapshot("user-a", self.project.id, first.id), first)

    def test_historical_snapshot_keeps_compiled_project_title_after_rename(self) -> None:
        first = self.compiler.compile("user-a", self.project.id, expected_project_version=1)
        current = self.store.get_project("user-a", self.project.id)
        self.store.update_project("user-a", replace(current, title="Renamed later", version=2), 1)
        historical = self.compiler.get_snapshot("user-a", self.project.id, first.id)
        self.assertEqual(first.project_title, "Northstar")
        self.assertEqual(historical.project_title, "Northstar")
        self.assertEqual(json.loads(first.canonical_json)["project_title"], "Northstar")

    def test_owner_isolation_and_expected_version(self) -> None:
        with self.assertRaises(ProjectNotFound):
            self.compiler.readiness("user-b", self.project.id)
        with self.assertRaises(ProjectNotFound):
            self.compiler.compile("user-b", self.project.id, expected_project_version=1)
        with self.assertRaises(VersionConflict):
            self.compiler.compile("user-a", self.project.id, expected_project_version=2)

    def test_non_semantic_domains_never_affect_readiness_or_snapshot(self) -> None:
        before = self.compiler.readiness("user-a", self.project.id)
        self.store.save_layout("user-a", self.project.id, {"decorative": (1.0, 2.0)}, 0)
        self.store.save_annotations("user-a", self.project.id, (), 0)
        after = self.compiler.readiness("user-a", self.project.id)
        self.assertEqual(before, after)

    def test_aggregate_sections_include_all_relevant_live_nodes(self) -> None:
        self.node("tagged-evidence", NodeType.EVIDENCE, "audience")
        self.node("tagged-assumption", NodeType.ASSUMPTION, "purpose")
        self.node("blocking-challenge", NodeType.CHALLENGE, "audience")
        self.node("advisory-challenge", NodeType.CHALLENGE, "purpose", extra_tags=("non-blocking",))
        self.node("trashed-challenge", NodeType.CHALLENGE, "purpose", state=NodeState.TRASH)
        snapshot = self.compiler.compile("user-a", self.project.id, expected_project_version=1)
        evidence = snapshot.sections["evidence-assumptions"]
        challenges = snapshot.sections["unresolved-challenges"]
        self.assertEqual(evidence.source_node_ids, ("tagged-assumption", "tagged-evidence"))
        self.assertEqual(challenges.source_node_ids, ("advisory-challenge", "blocking-challenge"))
        self.assertEqual(challenges.challenge_ids, ("advisory-challenge", "blocking-challenge"))
        self.assertEqual(challenges.blocking_challenge_ids, ("blocking-challenge",))

    def test_semantic_race_before_snapshot_persist_rejects_stale_row(self) -> None:
        class RacingStore(InMemoryProjectStore):
            raced = False
            def create_snapshot(self, user_id, snapshot, expected_project_version):
                if not self.raced:
                    self.raced = True
                    self.commit_node_creation(
                        user_id, GraphNode.create(snapshot.project_id, NodeType.IDEA, "Race", "Changed",
                                                  CreationSource.USER), expected_project_version,
                    )
                return super().create_snapshot(user_id, snapshot, expected_project_version)

        store = RacingStore()
        project = store.create_project("user-a", Project.create("user-a", "Race"))
        with self.assertRaises(VersionConflict):
            BlueprintCompiler(store).compile("user-a", project.id, expected_project_version=1)
        self.assertEqual(store.list_snapshots("user-a", project.id), ())

    def test_existing_same_version_snapshot_still_checks_atomic_project_version(self) -> None:
        class RacingStore(InMemoryProjectStore):
            armed = False
            def create_snapshot(self, user_id, snapshot, expected_project_version):
                if self.armed:
                    self.armed = False
                    self.commit_node_creation(
                        user_id, GraphNode.create(snapshot.project_id, NodeType.IDEA, "Race", "Changed",
                                                  CreationSource.USER), expected_project_version,
                    )
                return super().create_snapshot(user_id, snapshot, expected_project_version)

        store = RacingStore()
        project = store.create_project("user-a", Project.create("user-a", "Race replay"))
        compiler = BlueprintCompiler(store)
        existing = compiler.compile("user-a", project.id, expected_project_version=1)
        store.armed = True
        with self.assertRaises(VersionConflict):
            compiler.compile("user-a", project.id, expected_project_version=1)
        self.assertEqual(store.list_snapshots("user-a", project.id), (existing,))

    def test_concurrent_same_version_winner_uses_one_snapshot_read(self) -> None:
        class InterleavingStore(InMemoryProjectStore):
            list_calls = 0
            def list_snapshots(self, user_id, project_id):
                self.list_calls += 1
                if self.list_calls > 1:
                    raise AssertionError("compiler read snapshots more than once")
                return super().list_snapshots(user_id, project_id)
            def create_snapshot(self, user_id, snapshot, expected_project_version):
                winner = replace(snapshot, id=str(uuid4()), sequence=snapshot.sequence + 1,
                                 name=f"Starter Brand Blueprint {snapshot.sequence + 1}")
                super().create_snapshot(user_id, winner, expected_project_version)
                return super().create_snapshot(user_id, snapshot, expected_project_version)

        store = InterleavingStore()
        project = store.create_project("user-a", Project.create("user-a", "Concurrent"))
        winner = BlueprintCompiler(store).compile("user-a", project.id, expected_project_version=1)
        self.assertEqual(winner.sequence, 2)
        self.assertEqual(store.list_calls, 1)
        self.assertEqual(InMemoryProjectStore.list_snapshots(store, "user-a", project.id), (winner,))


if __name__ == "__main__":
    unittest.main()
