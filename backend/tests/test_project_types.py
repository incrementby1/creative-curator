import dataclasses
from datetime import datetime
import unittest
from uuid import UUID

from app.projects.types import (
    AnalysisProposal, AnnotationType, BlueprintSnapshot, CanvasAnnotation, CanvasMedia,
    ChallengeResolution, ChallengeState, CreationSource, EdgeType, GraphEdge, GraphNode,
    NodeRevision, NodeState, NodeType, Project, ProjectStatus, ProposalState, ThemeChoice,
)


def assert_utc(test: unittest.TestCase, value: str) -> None:
    parsed = datetime.fromisoformat(value)
    test.assertIsNotNone(parsed.tzinfo)
    test.assertEqual(parsed.utcoffset().total_seconds(), 0)


class ProjectTypeTests(unittest.TestCase):
    def test_enum_values_match_graph_contract(self) -> None:
        self.assertEqual({item.value for item in NodeType}, {"evidence", "assumption", "idea", "decision", "challenge", "output"})
        self.assertEqual({item.value for item in EdgeType}, {"supports", "contradicts", "depends_on", "inspires", "supersedes"})
        self.assertEqual({item.value for item in NodeState}, {"working", "approved", "trash"})
        self.assertEqual({item.value for item in CreationSource}, {"user", "hermes", "import"})
        self.assertEqual({item.value for item in ChallengeState}, {"open", "acknowledged", "resolved", "deferred", "overridden"})
        self.assertEqual({item.value for item in ProposalState}, {"pending", "accepted", "rejected"})
        self.assertEqual({item.value for item in ThemeChoice}, {"paper", "graphite", "project"})

    def test_project_factory_generates_id_trims_title_and_initializes_record(self) -> None:
        project = Project.create(" owner-1 ", "  Acme Brand  ")
        UUID(project.id)
        self.assertEqual((project.owner_id, project.title), ("owner-1", "Acme Brand"))
        self.assertEqual((project.status, project.version), (ProjectStatus.ACTIVE, 1))
        assert_utc(self, project.created_at)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            project.title = "changed"  # type: ignore[misc]

    def test_node_factory_accepts_enum_or_valid_string_and_generates_id(self) -> None:
        node = GraphNode.create(" project-1 ", "evidence", " Title ", " Content ", "hermes", " imported brief ")
        UUID(node.id)
        self.assertEqual(node.node_type, NodeType.EVIDENCE)
        self.assertEqual(node.created_by, CreationSource.HERMES)
        self.assertEqual((node.title, node.content, node.provenance), ("Title", "Content", "imported brief"))
        self.assertEqual((node.state, node.version), (NodeState.WORKING, 1))
        assert_utc(self, node.updated_at)
        enum_node = GraphNode.create("p", NodeType.IDEA, "t", "c", CreationSource.USER)
        self.assertEqual(enum_node.node_type, NodeType.IDEA)

    def test_edge_factory_accepts_string_generates_id_and_rejects_self_reference(self) -> None:
        edge = GraphEdge.create(" project-1 ", " source ", " target ", "depends_on")
        UUID(edge.id)
        self.assertEqual((edge.source_node_id, edge.target_node_id), ("source", "target"))
        self.assertEqual((edge.edge_type, edge.version), (EdgeType.DEPENDS_ON, 1))
        with self.assertRaisesRegex(ValueError, "self"):
            GraphEdge.create("p", "node", " node ", EdgeType.SUPPORTS)

    def test_factories_reject_blank_and_unknown_values(self) -> None:
        cases = [
            lambda: Project.create(" ", "title"),
            lambda: Project.create("owner", " "),
            lambda: GraphNode.create("p", "unknown", "t", "c", "user"),
            lambda: GraphNode.create("p", "idea", "t", "c", "robot"),
            lambda: GraphNode.create("p", "idea", " ", "c", "user"),
            lambda: GraphEdge.create("p", "a", "b", "unknown"),
        ]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                case()

    def test_collection_inputs_are_copied_to_immutable_tuples(self) -> None:
        tags = [" strategy ", "voice"]
        node = GraphNode.create("p", "idea", "t", "c", "user", tags=tags)
        tags.append("late")
        self.assertEqual(node.tags, ("strategy", "voice"))
        proposal = AnalysisProposal.create(
            id="ap", project_id="p", title=" Title ", rationale=" Why ",
            target_node_ids=[" n1 ", "n2"], creation_source=CreationSource.HERMES,
        )
        self.assertEqual(proposal.target_node_ids, ("n1", "n2"))

    def test_annotation_and_media_are_versioned_frozen_records(self) -> None:
        media = CanvasMedia.create(
            id="m", project_id="p", owner_id="o", storage_key="01JOPAQUEKEY",
            mime_type="image/png", byte_length=12, sha256="a" * 64,
        )
        annotation = CanvasAnnotation.create(
            id="a", project_id="p", owner_id="o", annotation_type=AnnotationType.FREEHAND,
            path_points=[(1, 2), (3.5, 4)], color="#fff",
        )
        self.assertEqual((media.version, annotation.version), (1, 1))
        self.assertEqual(annotation.path_points, ((1.0, 2.0), (3.5, 4.0)))
        assert_utc(self, media.created_at)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            annotation.color = "red"  # type: ignore[misc]

    def test_media_attachment_checks_owner_and_project_scope(self) -> None:
        media = CanvasMedia.create(
            id=" media-1 ", project_id="project-1", owner_id="owner-1", storage_key="opaque",
            mime_type="image/png", byte_length=1, sha256="b" * 64,
        )
        annotation = CanvasAnnotation.create_media(id="a", project_id="project-1", owner_id="owner-1", media=media)
        self.assertEqual(annotation.media_id, "media-1")
        for project_id, owner_id in (("wrong", "owner-1"), ("project-1", "wrong")):
            with self.subTest(project_id=project_id, owner_id=owner_id), self.assertRaises(ValueError):
                CanvasAnnotation.create_media(id="a", project_id=project_id, owner_id=owner_id, media=media)

    def test_annotation_and_media_expose_no_paths_or_semantic_fields(self) -> None:
        annotation_fields = {field.name for field in dataclasses.fields(CanvasAnnotation)}
        media_fields = {field.name for field in dataclasses.fields(CanvasMedia)}
        self.assertTrue(annotation_fields.isdisjoint({"node_id", "edge_id", "evidence", "approved", "approval"}))
        self.assertTrue(media_fields.isdisjoint({"path", "filesystem_path", "bucket", "bucket_path"}))
        with self.assertRaises(ValueError):
            CanvasAnnotation.create(id="a", project_id="p", owner_id="o", annotation_type=AnnotationType.MEDIA, media_id="data:image/png;base64,x")
        for key in ("/tmp/file.png", "bucket/file.png", "https://host/file.png"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                CanvasMedia.create(id="m", project_id="p", owner_id="o", storage_key=key, mime_type="image/png", byte_length=1, sha256="b" * 64)

    def test_revision_captures_node_version_without_inventing_record_version(self) -> None:
        revision = NodeRevision.create(id=" r ", project_id=" p ", node_id=" n ", node_version=3, title=" T ", content=" C ")
        self.assertEqual((revision.id, revision.project_id, revision.node_id), ("r", "p", "n"))
        self.assertEqual((revision.node_version, revision.title, revision.content), (3, "T", "C"))
        self.assertNotIn("version", {field.name for field in dataclasses.fields(NodeRevision)})
        assert_utc(self, revision.created_at)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            revision.content = "changed"  # type: ignore[misc]

    def test_proposal_and_challenge_resolution_initialize_version_one(self) -> None:
        proposal = AnalysisProposal.create(id=" p1 ", project_id=" p ", title=" T ", rationale=" R ", target_node_ids=[" n "])
        challenge = ChallengeResolution.create(id=" c1 ", project_id=" p ", challenge_id=" n ", resolution=" Resolve it ")
        self.assertEqual((proposal.version, proposal.state), (1, ProposalState.PENDING))
        self.assertEqual((challenge.version, challenge.state), (1, ChallengeState.OPEN))
        assert_utc(self, proposal.updated_at)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            challenge.resolution = "changed"  # type: ignore[misc]

    def test_blueprint_snapshot_has_explicit_snapshot_version_and_immutable_ids(self) -> None:
        snapshot = BlueprintSnapshot.create(id=" s ", project_id=" p ", name=" First ", node_ids=[" n1 "], edge_ids=[" e1 "])
        self.assertEqual((snapshot.id, snapshot.project_id, snapshot.name), ("s", "p", "First"))
        self.assertEqual((snapshot.node_ids, snapshot.edge_ids, snapshot.version), (("n1",), ("e1",), 1))
        assert_utc(self, snapshot.created_at)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            snapshot.version = 2  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
