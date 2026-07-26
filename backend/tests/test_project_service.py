from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from threading import Event, Thread
import unittest

from app.projects.service import ProjectService
from app.projects.store import (
    GraphItemNotFound, InMemoryProjectStore, InvalidMedia, ProjectNotFound, VersionConflict,
)
from app.projects.types import (
    BlueprintSnapshot, CanvasAnnotation, CreationSource, EdgeType, GraphNode,
    NodeState, NodeType, ThemeChoice,
)


PNG = b"\x89PNG\r\n\x1a\n" + b"payload"
JPEG = b"\xff\xd8\xff\xe0" + b"payload"
WEBP = b"RIFF\x08\x00\x00\x00WEBP" + b"payload"


class ProjectServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = InMemoryProjectStore()
        self.service = ProjectService(self.store)
        self.project = self.service.create_project("user-a", " New brand ")

    def create_node(self, title: str = "Thought", node_type: str = "idea"):
        project = self.store.get_project("user-a", self.project.id)
        assert project is not None
        return self.service.create_node(
            "user-a", self.project.id, node_type, title, "Content", "user", project.version,
        )

    def semantic_snapshot(self) -> tuple[object, ...]:
        project = self.store.get_project("user-a", self.project.id)
        nodes = self.store.list_nodes("user-a", self.project.id)
        edges = self.store.list_edges("user-a", self.project.id)
        revisions = tuple(
            (node.id, self.store.list_revisions("user-a", self.project.id, node.id)) for node in nodes
        )
        analyses = self.store.list_analyses("user-a", self.project.id)
        snapshots = self.store.list_snapshots("user-a", self.project.id)
        readiness_graph = tuple(
            (node.id, node.node_type, node.state, node.version, node.title, node.content) for node in nodes
        ), tuple((edge.id, edge.source_node_id, edge.target_node_id, edge.edge_type, edge.version) for edge in edges)
        return project, nodes, edges, revisions, analyses, snapshots, readiness_graph

    def seed_nonsemantic_dependencies(self, node_id: str) -> None:
        self.store.put_analysis(
            "user-a", self.project.id, "analysis-key",
            {"dependencies": {"nodes": [node_id], "edges": []}, "readiness": "fragile"},
        )
        current_version = self.store.get_project("user-a", self.project.id).version
        snapshot = BlueprintSnapshot.create(
                project_id=self.project.id, project_title=self.project.title, name="Blueprint", node_ids=[node_id], edge_ids=[],
            )
        self.store.create_snapshot(
            "user-a", replace(snapshot, project_version=current_version), current_version,
        )

    def test_project_creation_list_and_graph_are_owner_scoped(self) -> None:
        second = self.service.create_project("user-a", "Second")
        self.service.create_project("user-b", "Foreign")
        self.assertEqual(set(self.service.list_projects("user-a")), {self.project, second})
        graph = self.service.get_graph("user-a", self.project.id)
        self.assertEqual(graph["project"], self.project)
        self.assertEqual((graph["nodes"], graph["edges"]), ((), ()))
        with self.assertRaises(ProjectNotFound):
            self.service.get_graph("user-b", self.project.id)

    def test_quick_capture_increments_project_version_and_rejects_stale_project(self) -> None:
        node = self.create_node("Quick thought")
        self.assertEqual(node.title, "Quick thought")
        self.assertEqual(self.store.get_project("user-a", self.project.id).version, 2)  # type: ignore[union-attr]
        with self.assertRaises(VersionConflict):
            self.service.create_node(
                "user-a", self.project.id, "idea", "Stale", "Content", "user", 1,
            )

    def test_edges_require_live_same_project_nodes_and_reject_duplicates(self) -> None:
        source, target = self.create_node("Source"), self.create_node("Target")
        version = self.store.get_project("user-a", self.project.id).version  # type: ignore[union-attr]
        edge = self.service.connect_nodes(
            "user-a", self.project.id, source.id, target.id, "supports", version,
        )
        self.assertEqual(edge.edge_type, EdgeType.SUPPORTS)
        current = self.store.get_project("user-a", self.project.id).version  # type: ignore[union-attr]
        with self.assertRaises(VersionConflict):
            self.service.connect_nodes(
                "user-a", self.project.id, source.id, target.id, "supports", current,
            )
        other = self.service.create_project("user-a", "Other")
        foreign = self.service.create_node("user-a", other.id, "idea", "Foreign", "Body", "user", 1)
        current = self.store.get_project("user-a", self.project.id).version  # type: ignore[union-attr]
        with self.assertRaises(GraphItemNotFound):
            self.service.connect_nodes(
                "user-a", self.project.id, source.id, foreign.id, "inspires", current,
            )

    def test_semantic_update_is_atomic_and_revision_preserves_all_prior_fields(self) -> None:
        node = self.create_node("Old", "assumption")
        updated = self.service.update_node_semantics(
            "user-a", self.project.id, node.id,
            node_type="decision", title="New", content="New content", state="approved",
            created_by="hermes", provenance="interview", tags=("audience",),
            expected_node_version=node.version,
        )
        self.assertEqual((updated.node_type, updated.state, updated.version), (NodeType.DECISION, NodeState.APPROVED, 2))
        revision, = self.store.list_revisions("user-a", self.project.id, node.id)
        self.assertEqual(
            (revision.node_type, revision.state, revision.created_by, revision.provenance, revision.tags),
            (NodeType.ASSUMPTION, NodeState.WORKING, CreationSource.USER, None, ()),
        )
        self.assertEqual((revision.title, revision.content, revision.node_version), ("Old", "Content", 1))
        with self.assertRaises(VersionConflict):
            self.service.update_node("user-a", self.project.id, node.id, "Stale", "No", 1)
        self.assertEqual(len(self.store.list_revisions("user-a", self.project.id, node.id)), 1)

    def test_challenge_metadata_survives_edits_and_clears_on_type_change(self) -> None:
        challenge = replace(
            GraphNode.create(self.project.id, "challenge", "Risk", "Unsupported claim", "hermes"),
            challenge_dependencies=("decision-1",), challenge_confidence=84,
            challenge_downstream_effect="Messaging may change",
        )
        self.store.create_node("user-a", challenge)
        edited = self.service.update_node_semantics(
            "user-a", self.project.id, challenge.id, node_type="challenge", title="Evidence risk",
            content="Still unsupported", state="working", created_by="hermes", provenance="analysis",
            tags=(), expected_node_version=1,
        )
        self.assertEqual(
            (edited.challenge_dependencies, edited.challenge_confidence, edited.challenge_downstream_effect),
            (("decision-1",), 84, "Messaging may change"),
        )
        converted = self.service.update_node_semantics(
            "user-a", self.project.id, challenge.id, node_type="idea", title="Evidence idea",
            content="Collect proof", state="working", created_by="hermes", provenance="analysis",
            tags=(), expected_node_version=2,
        )
        self.assertEqual(
            (converted.challenge_dependencies, converted.challenge_confidence,
             converted.challenge_downstream_effect), ((), None, None),
        )
        revisions = self.store.list_revisions("user-a", self.project.id, challenge.id)
        self.assertEqual([item.node_version for item in revisions], [1, 2])
        self.assertEqual(revisions[1].challenge_confidence, 84)

    def test_soft_trash_restore_and_approve_decision_are_versioned_semantic_updates(self) -> None:
        node = self.create_node(node_type="decision")
        trashed = self.service.trash_node("user-a", self.project.id, node.id, node.version)
        restored = self.service.restore_node("user-a", self.project.id, node.id, trashed.version)
        approved = self.service.approve_decision("user-a", self.project.id, node.id, restored.version)
        self.assertEqual((trashed.state, restored.state, approved.state), (NodeState.TRASH, NodeState.WORKING, NodeState.APPROVED))
        self.assertEqual([r.node_version for r in self.store.list_revisions("user-a", self.project.id, node.id)], [1, 2, 3])

    def test_foundational_decision_change_marks_semantic_dependents_for_review_atomically(self) -> None:
        foundation = self.create_node("Positioning", node_type="decision")
        foundation = self.service.approve_decision("user-a", self.project.id, foundation.id, foundation.version)
        dependent = self.create_node("Promise", node_type="decision")
        project = self.store.get_project("user-a", self.project.id); assert project is not None
        self.service.connect_nodes("user-a", self.project.id, foundation.id, dependent.id, "supports", project.version)
        project = self.store.get_project("user-a", self.project.id); assert project is not None
        self.service.update_node_semantics("user-a", self.project.id, foundation.id, node_type="decision", title="Changed positioning", content=foundation.content, state="approved", created_by="user", provenance=None, tags=(), expected_node_version=foundation.version, expected_project_version=project.version)
        invalidated = self.store.get_node("user-a", self.project.id, dependent.id); assert invalidated is not None
        self.assertEqual(invalidated.state, NodeState.REVIEW_SUGGESTED)
        self.assertEqual([r.node_version for r in self.store.list_revisions("user-a", self.project.id, dependent.id)], [dependent.version])

    def test_trash_rejects_node_with_live_relationship_without_partial_mutation(self) -> None:
        source, target = self.create_node("Source"), self.create_node("Target")
        project_version = self.store.get_project("user-a", self.project.id).version  # type: ignore[union-attr]
        edge = self.service.connect_nodes(
            "user-a", self.project.id, source.id, target.id, "supports", project_version,
        )
        before = self.semantic_snapshot()
        with self.assertRaises(VersionConflict):
            self.service.trash_node("user-a", self.project.id, source.id, source.version)
        self.assertEqual(self.semantic_snapshot(), before)
        self.assertEqual(self.store.get_edge("user-a", self.project.id, edge.id), edge)

    def test_relationship_update_delete_use_project_and_edge_cas(self) -> None:
        source, target = self.create_node("Source"), self.create_node("Target")
        project_version = self.store.get_project("user-a", self.project.id).version  # type: ignore[union-attr]
        edge = self.service.connect_nodes("user-a", self.project.id, source.id, target.id, "supports", project_version)
        project_version += 1
        changed = self.service.update_relationship(
            "user-a", self.project.id, edge.id, "contradicts", "Conflict", edge.version, project_version,
        )
        self.assertEqual((changed.edge_type, changed.version), (EdgeType.CONTRADICTS, 2))
        with self.assertRaises(VersionConflict):
            self.service.delete_relationship(
                "user-a", self.project.id, edge.id, changed.version, project_version,
            )
        self.service.delete_relationship(
            "user-a", self.project.id, edge.id, changed.version, project_version + 1,
        )
        self.assertEqual(self.store.list_edges("user-a", self.project.id), ())

    def test_layout_writes_are_separate_and_semantically_inert(self) -> None:
        node = self.create_node()
        self.seed_nonsemantic_dependencies(node.id)
        before = self.semantic_snapshot()
        self.assertEqual(self.service.save_layout("user-a", self.project.id, {node.id: (120.0, 80.0)}, 0), 1)
        self.assertEqual(self.service.save_layout("user-a", self.project.id, {node.id: (2.0, 3.0)}, 1), 2)
        self.assertEqual(self.semantic_snapshot(), before)

    def test_annotation_create_update_delete_are_isolated_and_semantically_inert(self) -> None:
        node = self.create_node()
        self.seed_nonsemantic_dependencies(node.id)
        before = self.semantic_snapshot()
        annotation = CanvasAnnotation.create(
            project_id=self.project.id, owner_id="user-a", annotation_type="freehand",
            path_points=((0, 0), (1, 1)), color="#111",
        )
        self.assertEqual(self.service.save_annotations("user-a", self.project.id, [annotation], 0), 1)
        changed = replace(
            annotation, color="#222", version=2,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )
        self.assertEqual(self.service.save_annotations("user-a", self.project.id, [changed], 1), 2)
        self.assertEqual(self.service.save_annotations("user-a", self.project.id, [], 2), 3)
        self.assertEqual(self.semantic_snapshot(), before)
        with self.assertRaises(VersionConflict):
            self.service.save_annotations("user-a", self.project.id, [], 2)

    def test_annotation_versions_reject_jumps_and_accept_unchanged_records(self) -> None:
        annotation = CanvasAnnotation.create(
            project_id=self.project.id, owner_id="user-a", annotation_type="freehand",
            path_points=((0, 0), (1, 1)),
        )
        self.service.save_annotations("user-a", self.project.id, [annotation], 0)
        self.assertEqual(self.service.save_annotations("user-a", self.project.id, [annotation], 1), 2)
        jumped = replace(
            annotation, color="#222", version=99,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )
        with self.assertRaises(VersionConflict):
            self.service.save_annotations("user-a", self.project.id, [jumped], 2)
        self.assertEqual(self.store.get_annotations("user-a", self.project.id), (2, (annotation,)))

    def test_persistence_rejects_malformed_direct_annotations_without_mutation(self) -> None:
        valid = CanvasAnnotation.create(
            project_id=self.project.id, owner_id="user-a", annotation_type="freehand",
            path_points=((0, 0), (1, 1)),
        )
        self.service.save_annotations("user-a", self.project.id, [valid], 0)
        malformed = (
            replace(valid, annotation_type="freehand"),  # type: ignore[arg-type]
            replace(valid, path_points=((0.0, 0.0),)),
            replace(valid, path_points=((0.0, 0.0), (float("nan"), 1.0))),
            replace(valid, version=99),
            replace(valid, updated_at="not-a-timestamp"),
            replace(valid, id="not-a-uuid"),
        )
        for candidate in malformed:
            with self.subTest(candidate=candidate), self.assertRaises((ValueError, VersionConflict)):
                self.service.save_annotations("user-a", self.project.id, [candidate], 1)
            self.assertEqual(self.store.get_annotations("user-a", self.project.id), (1, (valid,)))

    def test_atomic_annotation_commit_and_media_delete_never_leave_dangling_reference(self) -> None:
        media = self.service.store_media("user-a", self.project.id, "a.png", "image/png", PNG)
        annotation = CanvasAnnotation.create_media(
            project_id=self.project.id, owner_id="user-a", media=media,
        )
        entered = Event()
        finished = Event()
        errors: list[BaseException] = []

        def save() -> None:
            entered.set()
            try:
                self.service.save_annotations("user-a", self.project.id, [annotation], 0)
            except BaseException as exc:
                errors.append(exc)
            finally:
                finished.set()

        with self.store._lock:  # deterministic delete-first serialization at persistence lock
            thread = Thread(target=save)
            thread.start()
            self.assertTrue(entered.wait(1))
            self.service.delete_media("user-a", self.project.id, media.id)
        self.assertTrue(finished.wait(1))
        thread.join()
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], InvalidMedia)
        self.assertEqual(self.store.get_annotations("user-a", self.project.id), (0, ()))
        self.assertIsNone(self.service.read_media("user-a", self.project.id, media.id))

    def test_layout_accepts_only_finite_non_bool_numbers_and_stores_floats(self) -> None:
        node = self.create_node()
        self.assertEqual(self.service.save_layout("user-a", self.project.id, {node.id: (1, 2.5)}, 0), 1)
        self.assertEqual(self.store.get_layout("user-a", self.project.id), (1, {node.id: (1.0, 2.5)}))
        invalid = ((True, 2), ("1", 2), (1,), (1, 2, 3), (float("inf"), 2))
        for position in invalid:
            with self.subTest(position=position), self.assertRaises(ValueError):
                self.service.save_layout("user-a", self.project.id, {node.id: position}, 1)  # type: ignore[dict-item]
            self.assertEqual(self.store.get_layout("user-a", self.project.id), (1, {node.id: (1.0, 2.5)}))

    def test_media_store_read_delete_validate_bytes_scope_and_semantic_isolation(self) -> None:
        node = self.create_node()
        self.seed_nonsemantic_dependencies(node.id)
        before = self.semantic_snapshot()
        media = self.service.store_media("user-a", self.project.id, "client.png", "image/png", PNG)
        self.assertNotIn("client", media.storage_key)
        self.assertEqual(self.service.read_media("user-a", self.project.id, media.id), (media, PNG))
        annotation = CanvasAnnotation.create_media(project_id=self.project.id, owner_id="user-a", media=media)
        self.service.save_annotations("user-a", self.project.id, [annotation], 0)
        self.assertEqual(self.semantic_snapshot(), before)
        with self.assertRaises(InvalidMedia):
            self.service.store_media("user-a", self.project.id, "fake.jpg", "image/jpeg", PNG)
        with self.assertRaises(InvalidMedia):
            self.service.store_media("user-a", self.project.id, "huge.png", "image/png", PNG[:8] + b"x" * (5 * 1024 * 1024))
        with self.assertRaises(InvalidMedia):
            self.service.delete_media("user-a", self.project.id, media.id)
        self.assertEqual(self.service.read_media("user-a", self.project.id, media.id), (media, PNG))
        self.assertEqual(self.store.get_annotations("user-a", self.project.id), (1, (annotation,)))
        self.service.save_annotations("user-a", self.project.id, [], 1)
        self.service.delete_media("user-a", self.project.id, media.id)
        self.assertIsNone(self.service.read_media("user-a", self.project.id, media.id))
        self.assertEqual(self.semantic_snapshot(), before)

    def test_jpeg_and_webp_magic_are_accepted_and_each_mime_mismatch_is_rejected(self) -> None:
        cases = (
            ("photo.jpg", "image/jpeg", JPEG, "image/png"),
            ("image.webp", "image/webp", WEBP, "image/jpeg"),
        )
        for filename, mime, payload, wrong_mime in cases:
            with self.subTest(mime=mime):
                media = self.service.store_media(
                    "user-a", self.project.id, filename, mime, payload,
                )
                self.assertEqual(media.mime_type, mime)
                self.assertEqual(
                    self.service.read_media("user-a", self.project.id, media.id),
                    (media, payload),
                )
                with self.assertRaises(InvalidMedia):
                    self.service.store_media(
                        "user-a", self.project.id, filename, wrong_mime, payload,
                    )

    def test_annotations_reject_foreign_or_missing_media(self) -> None:
        media = self.service.store_media("user-a", self.project.id, "a.png", "image/png", PNG)
        annotation = CanvasAnnotation.create_media(project_id=self.project.id, owner_id="user-a", media=media)
        self.service.delete_media("user-a", self.project.id, media.id)
        with self.assertRaises(InvalidMedia):
            self.service.save_annotations("user-a", self.project.id, [annotation], 0)

    def test_global_theme_and_optional_project_override_resolve_without_semantic_change(self) -> None:
        before = self.semantic_snapshot()
        self.service.set_user_theme("user-a", "graphite")
        self.assertEqual(self.service.get_graph("user-a", self.project.id)["theme"], ThemeChoice.GRAPHITE)
        self.service.set_project_theme("user-a", self.project.id, "project")
        self.assertEqual(self.service.get_graph("user-a", self.project.id)["theme"], ThemeChoice.PROJECT)
        self.service.set_project_theme("user-a", self.project.id, None)
        self.assertEqual(self.service.get_graph("user-a", self.project.id)["theme"], ThemeChoice.GRAPHITE)
        self.assertEqual(self.semantic_snapshot(), before)

    def test_graph_exposes_theme_preference_sources_for_controlled_client(self) -> None:
        self.service.set_user_theme("user-a", "graphite")
        self.service.set_project_theme("user-a", self.project.id, "project")
        graph = self.service.get_graph("user-a", self.project.id)
        self.assertEqual(graph["global_theme"], ThemeChoice.GRAPHITE)
        self.assertEqual(graph["project_theme"], ThemeChoice.PROJECT)
        self.assertEqual(graph["theme"], ThemeChoice.PROJECT)


if __name__ == "__main__":
    unittest.main()
