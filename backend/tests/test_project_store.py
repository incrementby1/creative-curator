from dataclasses import replace
import hashlib
import unittest

from app.projects.store import (
    GraphItemNotFound,
    InMemoryProjectStore,
    InvalidMedia,
    ProjectNotFound,
    VersionConflict,
)
from app.projects.types import (
    AnalysisProposal,
    BlueprintSnapshot,
    CanvasAnnotation,
    CanvasMedia,
    GraphEdge,
    GraphNode,
    NodeRevision,
    NodeState,
    Project,
    ProposalState,
    ThemeChoice,
)


class InMemoryProjectStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = InMemoryProjectStore()
        self.project = Project.create("user-a", "New brand")
        self.store.create_project("user-a", self.project)

    def make_node(self, title: str = "Thought") -> GraphNode:
        return GraphNode.create(self.project.id, "idea", title, "Content", "user")

    def test_project_is_owner_scoped_ordered_and_copied(self) -> None:
        second = Project.create("user-a", "Later")
        foreign = Project.create("user-b", "Foreign")
        self.store.create_project("user-a", second)
        self.store.create_project("user-b", foreign)

        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)
        self.assertIsNone(self.store.get_project("user-b", self.project.id))
        self.assertEqual(
            [project.id for project in self.store.list_projects("user-a")],
            sorted([self.project.id, second.id]),
        )
        loaded = self.store.get_project("user-a", self.project.id)
        self.assertIsNot(loaded, self.project)

    def test_payload_owner_never_grants_access(self) -> None:
        forged = Project.create("user-b", "Forged")
        with self.assertRaises(ProjectNotFound):
            self.store.create_project("user-a", forged)
        self.assertIsNone(self.store.get_project("user-b", forged.id))

    def test_node_compare_and_swap_rejects_stale_version(self) -> None:
        node = self.make_node()
        self.store.create_node("user-a", node)
        updated = replace(node, title="Changed", version=2)
        self.assertEqual(self.store.update_node("user-a", updated, expected_version=1), updated)
        with self.assertRaises(VersionConflict):
            self.store.update_node("user-a", updated, expected_version=1)

    def test_atomic_semantic_update_commits_revision_node_and_project(self) -> None:
        node = self.make_node()
        self.store.create_node("user-a", node)
        candidate = replace(node, title="Changed", version=2)
        revision = NodeRevision.create(
            project_id=self.project.id, node_id=node.id, node_version=node.version,
            title=node.title, content=node.content,
        )

        result = self.store.commit_node_semantic_update(
            "user-a", candidate, revision,
            expected_node_version=1, expected_project_version=1,
        )

        self.assertEqual(result, candidate)
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]
        self.assertEqual(self.store.list_revisions("user-a", self.project.id, node.id), (revision,))

    def test_atomic_semantic_update_stale_cas_changes_nothing(self) -> None:
        node = self.make_node()
        self.store.create_node("user-a", node)
        candidate = replace(node, title="Changed", version=2)
        revision = NodeRevision.create(
            project_id=self.project.id, node_id=node.id, node_version=1,
            title=node.title, content=node.content,
        )

        with self.assertRaises(VersionConflict):
            self.store.commit_node_semantic_update(
                "user-a", candidate, revision,
                expected_node_version=1, expected_project_version=2,
            )

        self.assertEqual(self.store.get_node("user-a", self.project.id, node.id), node)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)
        self.assertEqual(self.store.list_revisions("user-a", self.project.id, node.id), ())

    def test_atomic_node_creation_bumps_project_and_stale_cas_writes_nothing(self) -> None:
        first = self.make_node("First")
        self.store.commit_node_creation("user-a", first, expected_project_version=1)
        self.assertEqual(self.store.get_node("user-a", self.project.id, first.id), first)
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]

        stale = self.make_node("Stale")
        with self.assertRaises(VersionConflict):
            self.store.commit_node_creation("user-a", stale, expected_project_version=1)
        self.assertIsNone(self.store.get_node("user-a", self.project.id, stale.id))
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]

    def test_atomic_semantic_state_update_revises_prior_state_and_stale_is_noop(self) -> None:
        node = self.make_node()
        self.store.create_node("user-a", node)
        trashed = replace(node, state=NodeState.TRASH, version=2)
        revision = NodeRevision.create(
            project_id=self.project.id, node_id=node.id, node_version=1,
            title=node.title, content=node.content,
        )
        self.store.commit_node_semantic_update(
            "user-a", trashed, revision, expected_node_version=1, expected_project_version=1,
        )
        stale_restore = replace(node, state=NodeState.WORKING, version=2)
        with self.assertRaises(VersionConflict):
            self.store.commit_node_semantic_update(
                "user-a", stale_restore, revision,
                expected_node_version=1, expected_project_version=1,
            )
        self.assertEqual(self.store.get_node("user-a", self.project.id, node.id), trashed)
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]
        self.assertEqual(self.store.list_revisions("user-a", self.project.id, node.id), (revision,))

    def test_atomic_edge_create_update_delete_and_stale_project_roll_back(self) -> None:
        source = self.make_node("Source")
        target = self.make_node("Target")
        self.store.create_node("user-a", source)
        self.store.create_node("user-a", target)
        edge = GraphEdge.create(self.project.id, source.id, target.id, "supports")

        self.store.commit_edge_creation("user-a", edge, expected_project_version=1)
        self.assertEqual(self.store.get_edge("user-a", self.project.id, edge.id), edge)
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]

        stale_edge = GraphEdge.create(self.project.id, target.id, source.id, "inspires")
        with self.assertRaises(VersionConflict):
            self.store.commit_edge_creation("user-a", stale_edge, expected_project_version=1)
        self.assertIsNone(self.store.get_edge("user-a", self.project.id, stale_edge.id))

        candidate = replace(edge, label="reason", version=2)
        with self.assertRaises(VersionConflict):
            self.store.commit_edge_update(
                "user-a", candidate, expected_edge_version=1, expected_project_version=1,
            )
        self.assertEqual(self.store.get_edge("user-a", self.project.id, edge.id), edge)
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]

        self.store.commit_edge_update(
            "user-a", candidate, expected_edge_version=1, expected_project_version=2,
        )
        self.assertEqual(self.store.get_edge("user-a", self.project.id, edge.id), candidate)
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 3)  # type: ignore[union-attr]

        with self.assertRaises(VersionConflict):
            self.store.commit_edge_deletion(
                "user-a", self.project.id, edge.id,
                expected_edge_version=2, expected_project_version=2,
            )
        self.assertEqual(self.store.get_edge("user-a", self.project.id, edge.id), candidate)
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 3)  # type: ignore[union-attr]

        self.store.commit_edge_deletion(
            "user-a", self.project.id, edge.id,
            expected_edge_version=2, expected_project_version=3,
        )
        self.assertIsNone(self.store.get_edge("user-a", self.project.id, edge.id))
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 4)  # type: ignore[union-attr]

    def test_edge_writes_reject_dangling_trashed_and_duplicate_semantics_without_changes(self) -> None:
        source = self.make_node("Source")
        target = self.make_node("Target")
        trashed = replace(self.make_node("Trash"), state=NodeState.TRASH)
        for node in (source, target, trashed):
            self.store.create_node("user-a", node)
        missing = self.make_node("Missing")

        for edge in (
            GraphEdge.create(self.project.id, source.id, missing.id, "supports"),
            GraphEdge.create(self.project.id, source.id, trashed.id, "supports"),
        ):
            with self.subTest(edge=edge), self.assertRaises(GraphItemNotFound):
                self.store.commit_edge_creation("user-a", edge, expected_project_version=1)
            self.assertIsNone(self.store.get_edge("user-a", self.project.id, edge.id))
            self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

        first = GraphEdge.create(self.project.id, source.id, target.id, "supports")
        self.store.create_edge("user-a", first)
        duplicate = GraphEdge.create(self.project.id, source.id, target.id, "supports")
        with self.assertRaises(VersionConflict):
            self.store.create_edge("user-a", duplicate)
        self.assertEqual(self.store.list_edges("user-a", self.project.id), (first,))
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

    def test_atomic_edge_update_rejects_semantic_duplicate_without_changes(self) -> None:
        first, second, third = self.make_node("First"), self.make_node("Second"), self.make_node("Third")
        for node in (first, second, third):
            self.store.create_node("user-a", node)
        existing = GraphEdge.create(self.project.id, first.id, second.id, "supports")
        changing = GraphEdge.create(self.project.id, first.id, third.id, "inspires")
        self.store.create_edge("user-a", existing)
        self.store.create_edge("user-a", changing)
        duplicate = replace(
            changing, target_node_id=second.id, edge_type=existing.edge_type, version=2,
        )

        with self.assertRaises(VersionConflict):
            self.store.commit_edge_update(
                "user-a", duplicate, expected_edge_version=1, expected_project_version=1,
            )
        self.assertEqual(self.store.get_edge("user-a", self.project.id, changing.id), changing)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

    def test_proposal_acceptance_rejects_dangling_edge_without_partial_write(self) -> None:
        proposal = AnalysisProposal.create(
            project_id=self.project.id, title="Proposal", rationale="Because", target_node_ids=["target"],
        )
        self.store.create_proposal("user-a", proposal)
        proposed = self.make_node("Proposed")
        dangling = GraphEdge.create(self.project.id, proposed.id, "missing", "supports")
        accepted = replace(proposal, state=ProposalState.ACCEPTED, version=2)

        with self.assertRaises(GraphItemNotFound):
            self.store.commit_proposal_acceptance(
                "user-a", accepted, [proposed], [dangling],
                expected_proposal_version=1, expected_project_version=1,
            )
        self.assertEqual(self.store.get_proposal("user-a", self.project.id, proposal.id), proposal)
        self.assertIsNone(self.store.get_node("user-a", self.project.id, proposed.id))
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

    def test_proposal_acceptance_rejects_duplicate_edges_and_replay(self) -> None:
        source, target = self.make_node("Source"), self.make_node("Target")
        self.store.create_node("user-a", source)
        self.store.create_node("user-a", target)
        existing = GraphEdge.create(self.project.id, source.id, target.id, "supports")
        self.store.create_edge("user-a", existing)
        proposal = AnalysisProposal.create(
            project_id=self.project.id, title="Proposal", rationale="Because", target_node_ids=[source.id],
        )
        self.store.create_proposal("user-a", proposal)
        duplicate = GraphEdge.create(self.project.id, source.id, target.id, "supports")
        accepted = replace(proposal, state=ProposalState.ACCEPTED, version=2)
        with self.assertRaises(VersionConflict):
            self.store.commit_proposal_acceptance(
                "user-a", accepted, [], [duplicate],
                expected_proposal_version=1, expected_project_version=1,
            )
        self.assertEqual(self.store.get_proposal("user-a", self.project.id, proposal.id), proposal)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

        proposed = self.make_node("Proposed")
        valid = GraphEdge.create(self.project.id, source.id, proposed.id, "inspires")
        self.store.commit_proposal_acceptance(
            "user-a", accepted, [proposed], [valid],
            expected_proposal_version=1, expected_project_version=1,
        )
        replay = replace(accepted, version=3)
        injected = self.make_node("Injected")
        with self.assertRaises(VersionConflict):
            self.store.commit_proposal_acceptance(
                "user-a", replay, [injected], [],
                expected_proposal_version=2, expected_project_version=2,
            )
        self.assertIsNone(self.store.get_node("user-a", self.project.id, injected.id))
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]

    def test_rejected_proposal_cannot_transition_to_accepted(self) -> None:
        proposal = AnalysisProposal.create(
            project_id=self.project.id, title="Proposal", rationale="Because", target_node_ids=["target"],
        )
        self.store.create_proposal("user-a", proposal)
        rejected = replace(proposal, state=ProposalState.REJECTED, version=2)
        self.store.update_proposal("user-a", rejected, expected_version=1)
        accepted = replace(rejected, state=ProposalState.ACCEPTED, version=3)
        with self.assertRaises(VersionConflict):
            self.store.commit_proposal_acceptance(
                "user-a", accepted, [], [],
                expected_proposal_version=2, expected_project_version=1,
            )
        self.assertEqual(self.store.get_proposal("user-a", self.project.id, proposal.id), rejected)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

    def test_direct_proposal_update_cannot_accept(self) -> None:
        proposal = AnalysisProposal.create(
            project_id=self.project.id, title="Proposal", rationale="Because", target_node_ids=["target"],
        )
        self.store.create_proposal("user-a", proposal)
        accepted = replace(proposal, state=ProposalState.ACCEPTED, version=2)
        with self.assertRaises(VersionConflict):
            self.store.update_proposal("user-a", accepted, expected_version=1)
        self.assertEqual(self.store.get_proposal("user-a", self.project.id, proposal.id), proposal)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

    def test_accepted_proposal_is_terminal_and_cannot_be_rejected(self) -> None:
        proposal = AnalysisProposal.create(
            project_id=self.project.id, title="Proposal", rationale="Because", target_node_ids=["target"],
        )
        self.store.create_proposal("user-a", proposal)
        node = self.make_node("Accepted node")
        accepted = replace(proposal, state=ProposalState.ACCEPTED, version=2)
        self.store.commit_proposal_acceptance(
            "user-a", accepted, [node], [],
            expected_proposal_version=1, expected_project_version=1,
        )
        rejected = replace(accepted, state=ProposalState.REJECTED, version=3)

        with self.assertRaises(VersionConflict):
            self.store.update_proposal("user-a", rejected, expected_version=2)
        self.assertEqual(self.store.get_proposal("user-a", self.project.id, proposal.id), accepted)
        self.assertEqual(self.store.get_node("user-a", self.project.id, node.id), node)
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]

    def test_rejected_proposal_is_terminal_even_for_same_state_edit(self) -> None:
        proposal = AnalysisProposal.create(
            project_id=self.project.id, title="Proposal", rationale="Because", target_node_ids=["target"],
        )
        self.store.create_proposal("user-a", proposal)
        rejected = replace(proposal, state=ProposalState.REJECTED, version=2)
        self.store.update_proposal("user-a", rejected, expected_version=1)
        relabeled = replace(rejected, title="Relabeled", version=3)

        with self.assertRaises(VersionConflict):
            self.store.update_proposal("user-a", relabeled, expected_version=2)
        self.assertEqual(self.store.get_proposal("user-a", self.project.id, proposal.id), rejected)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

    def test_node_deletion_rejects_incident_edges_without_changes(self) -> None:
        source, target = self.make_node("Source"), self.make_node("Target")
        self.store.create_node("user-a", source)
        self.store.create_node("user-a", target)
        edge = GraphEdge.create(self.project.id, source.id, target.id, "supports")
        self.store.create_edge("user-a", edge)

        with self.assertRaises(VersionConflict):
            self.store.delete_node("user-a", self.project.id, source.id, expected_version=1)
        self.assertEqual(self.store.get_node("user-a", self.project.id, source.id), source)
        self.assertEqual(self.store.get_edge("user-a", self.project.id, edge.id), edge)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

        with self.assertRaises(VersionConflict):
            self.store.commit_node_deletion(
                "user-a", self.project.id, target.id,
                expected_node_version=1, expected_project_version=1,
            )
        self.assertEqual(self.store.get_node("user-a", self.project.id, target.id), target)
        self.assertEqual(self.store.get_edge("user-a", self.project.id, edge.id), edge)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)

    def test_atomic_node_deletion_uses_project_cas(self) -> None:
        node = self.make_node()
        self.store.create_node("user-a", node)
        with self.assertRaises(VersionConflict):
            self.store.commit_node_deletion(
                "user-a", self.project.id, node.id,
                expected_node_version=1, expected_project_version=2,
            )
        self.assertEqual(self.store.get_node("user-a", self.project.id, node.id), node)
        self.assertEqual(self.store.get_project("user-a", self.project.id), self.project)
        self.store.commit_node_deletion(
            "user-a", self.project.id, node.id,
            expected_node_version=1, expected_project_version=1,
        )
        self.assertIsNone(self.store.get_node("user-a", self.project.id, node.id))
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]

    def test_graph_domains_are_owner_scoped_and_deterministically_ordered(self) -> None:
        first = self.make_node("B")
        second = self.make_node("A")
        self.store.create_node("user-a", first)
        self.store.create_node("user-a", second)
        edge = GraphEdge.create(self.project.id, first.id, second.id, "supports")
        self.store.create_edge("user-a", edge)
        proposal = AnalysisProposal.create(
            project_id=self.project.id, title="Proposal", rationale="Because",
            target_node_ids=[first.id],
        )
        self.store.create_proposal("user-a", proposal)
        snapshot = BlueprintSnapshot.create(
            project_id=self.project.id, name="Blueprint", node_ids=[first.id], edge_ids=[edge.id],
        )
        self.store.create_snapshot("user-a", snapshot)

        self.assertEqual([item.id for item in self.store.list_nodes("user-a", self.project.id)], sorted([first.id, second.id]))
        self.assertEqual(self.store.list_edges("user-a", self.project.id), (edge,))
        self.assertEqual(self.store.list_proposals("user-a", self.project.id), (proposal,))
        self.assertEqual(self.store.list_snapshots("user-a", self.project.id), (snapshot,))
        for getter in (
            lambda: self.store.list_nodes("user-b", self.project.id),
            lambda: self.store.list_edges("user-b", self.project.id),
            lambda: self.store.list_proposals("user-b", self.project.id),
            lambda: self.store.list_snapshots("user-b", self.project.id),
        ):
            self.assertEqual(getter(), ())

    def test_analysis_cache_is_scoped_copied_and_ordered(self) -> None:
        analysis = {"result": ["fragile"]}
        self.store.put_analysis("user-a", self.project.id, "z-key", analysis)
        self.store.put_analysis("user-a", self.project.id, "a-key", {"result": ["ready"]})
        analysis["result"].append("mutated")

        self.assertEqual(self.store.get_analysis("user-a", self.project.id, "z-key"), {"result": ["fragile"]})
        loaded = self.store.get_analysis("user-a", self.project.id, "z-key")
        loaded["result"].append("local")  # type: ignore[index,union-attr]
        self.assertEqual([key for key, _ in self.store.list_analyses("user-a", self.project.id)], ["a-key", "z-key"])
        self.assertIsNone(self.store.get_analysis("user-b", self.project.id, "z-key"))

    def test_layout_and_annotations_have_separate_versions(self) -> None:
        node = self.make_node()
        self.store.create_node("user-a", node)
        annotation = CanvasAnnotation.create(
            project_id=self.project.id, owner_id="user-a", annotation_type="freehand",
            path_points=[(0, 0), (1, 1)],
        )

        self.assertEqual(self.store.save_layout("user-a", self.project.id, {node.id: (2.0, 3.0)}, expected_version=0), 1)
        self.assertEqual(self.store.save_annotations("user-a", self.project.id, [annotation], expected_version=0), 1)
        self.assertEqual(self.store.get_layout("user-a", self.project.id), (1, {node.id: (2.0, 3.0)}))
        self.assertEqual(self.store.get_annotations("user-a", self.project.id), (1, (annotation,)))
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 1)  # type: ignore[union-attr]
        with self.assertRaises(VersionConflict):
            self.store.save_layout("user-a", self.project.id, {}, expected_version=0)
        with self.assertRaises(VersionConflict):
            self.store.save_annotations("user-a", self.project.id, [], expected_version=0)
        self.assertEqual(self.store.get_layout("user-b", self.project.id), (0, {}))
        self.assertEqual(self.store.get_annotations("user-b", self.project.id), (0, ()))

    def test_media_metadata_and_bytes_are_scoped_and_copy_safe(self) -> None:
        content = bytearray(b"image bytes")
        media = CanvasMedia.create(
            project_id=self.project.id, owner_id="user-a", storage_key="opaque",
            mime_type="image/png", byte_length=len(content), sha256=hashlib.sha256(content).hexdigest(),
        )
        self.store.store_media("user-a", media, content)
        content[0] = ord("X")

        loaded_media, loaded_content = self.store.read_media("user-a", self.project.id, media.id)  # type: ignore[misc]
        self.assertEqual((loaded_media, loaded_content), (media, b"image bytes"))
        self.assertIsNone(self.store.read_media("user-b", self.project.id, media.id))
        with self.assertRaises(InvalidMedia):
            self.store.store_media("user-a", replace(media, byte_length=1), b"image bytes")

    def test_media_digest_mismatch_is_rejected_before_persistence(self) -> None:
        content = b"image bytes"
        media = CanvasMedia.create(
            project_id=self.project.id, owner_id="user-a", storage_key="opaque-digest",
            mime_type="image/png", byte_length=len(content), sha256=hashlib.sha256(b"other").hexdigest(),
        )
        with self.assertRaises(InvalidMedia):
            self.store.store_media("user-a", media, content)
        self.assertIsNone(self.store.read_media("user-a", self.project.id, media.id))

    def test_theme_preferences_are_owner_scoped(self) -> None:
        self.store.set_user_theme("user-a", ThemeChoice.GRAPHITE)
        self.store.set_project_theme("user-a", self.project.id, ThemeChoice.PROJECT)
        self.assertEqual(self.store.get_user_theme("user-a"), ThemeChoice.GRAPHITE)
        self.assertEqual(self.store.get_project_theme("user-a", self.project.id), ThemeChoice.PROJECT)
        self.assertEqual(self.store.get_user_theme("user-b"), ThemeChoice.PAPER)
        self.assertIsNone(self.store.get_project_theme("user-b", self.project.id))

    def test_missing_owned_items_raise_typed_errors_on_mutation(self) -> None:
        node = self.make_node()
        with self.assertRaises(GraphItemNotFound):
            self.store.update_node("user-a", node, expected_version=1)
        with self.assertRaises(ProjectNotFound):
            self.store.save_layout("user-b", self.project.id, {}, expected_version=0)


if __name__ == "__main__":
    unittest.main()
