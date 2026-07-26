from __future__ import annotations

from dataclasses import replace
import json
import unittest

from app.projects.blueprint import BlueprintCompiler, REQUIRED_BLUEPRINT_SECTIONS
from app.projects.store import InMemoryProjectStore, ProjectNotFound, VersionConflict
from app.projects.types import (
    ChallengeResolution, ChallengeState, CreationSource, GraphNode, NodeState,
    NodeType, Project,
)


class BlueprintCompilerTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
