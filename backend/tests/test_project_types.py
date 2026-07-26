import dataclasses
import unittest

from app.projects.types import (
    AnalysisProposal,
    AnnotationType,
    CanvasAnnotation,
    CanvasMedia,
    CreationSource,
    EdgeType,
    GraphEdge,
    GraphNode,
    NodeState,
    NodeType,
    Project,
    ProjectStatus,
)


class ProjectTypeTests(unittest.TestCase):
    def test_graph_node_create_normalizes_text_and_starts_version_one(self) -> None:
        node = GraphNode.create(
            id=" node-1 ", project_id=" project-1 ", node_type=NodeType.BRAND,
            title="  North Star  ", content="  Clear positioning.  ",
        )
        self.assertEqual((node.id, node.project_id), ("node-1", "project-1"))
        self.assertEqual((node.title, node.content, node.version), ("North Star", "Clear positioning.", 1))
        self.assertEqual(node.state, NodeState.ACTIVE)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            node.title = "changed"  # type: ignore[misc]

    def test_graph_edge_create_rejects_self_reference(self) -> None:
        with self.assertRaisesRegex(ValueError, "self"):
            GraphEdge.create(
                id="edge-1", project_id="project-1", source_node_id="node-1",
                target_node_id=" node-1 ", edge_type=EdgeType.SUPPORTS,
            )

    def test_project_create_starts_active_at_version_one(self) -> None:
        project = Project.create(id=" project-1 ", owner_id=" owner-1 ", name="  Acme Brand  ")
        self.assertEqual((project.id, project.owner_id, project.name), ("project-1", "owner-1", "Acme Brand"))
        self.assertEqual((project.status, project.version), (ProjectStatus.ACTIVE, 1))

    def test_factories_reject_blank_required_values(self) -> None:
        cases = [
            lambda: Project.create(id=" ", owner_id="owner", name="name"),
            lambda: GraphNode.create(id="node", project_id="project", node_type=NodeType.BRAND, title=" ", content="body"),
            lambda: GraphNode.create(id="node", project_id="project", node_type=NodeType.BRAND, title="title", content=" "),
            lambda: GraphEdge.create(id="edge", project_id="project", source_node_id=" ", target_node_id="node", edge_type=EdgeType.SUPPORTS),
        ]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                case()

    def test_timestamps_are_utc_iso_strings(self) -> None:
        values = [
            Project.create(id="p", owner_id="o", name="n").created_at,
            GraphNode.create(id="n", project_id="p", node_type=NodeType.BRAND, title="t", content="c").created_at,
            GraphEdge.create(id="e", project_id="p", source_node_id="a", target_node_id="b", edge_type=EdgeType.SUPPORTS).created_at,
        ]
        for value in values:
            self.assertRegex(value, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?\+00:00$")

    def test_collection_inputs_become_immutable(self) -> None:
        tags = [" strategy ", "voice"]
        node = GraphNode.create(
            id="n", project_id="p", node_type=NodeType.BRAND, title="t", content="c", tags=tags,
        )
        tags.append("late")
        self.assertEqual(node.tags, ("strategy", "voice"))
        proposal = AnalysisProposal.create(
            id="ap", project_id="p", title="Title", rationale="Why", target_node_ids=[" n1 ", "n2"],
            creation_source=CreationSource.ANALYSIS,
        )
        self.assertEqual(proposal.target_node_ids, ("n1", "n2"))

    def test_factories_reject_untyped_enum_values(self) -> None:
        with self.assertRaises(ValueError):
            Project.create(id="p", owner_id="o", name="n", theme="dark")  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            GraphNode.create(id="n", project_id="p", node_type="brand", title="t", content="c")  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            GraphEdge.create(id="e", project_id="p", source_node_id="a", target_node_id="b", edge_type="supports")  # type: ignore[arg-type]

    def test_annotation_contains_only_decorative_owner_scoped_payload(self) -> None:
        annotation = CanvasAnnotation.create(
            id="a", project_id="p", owner_id="o", annotation_type=AnnotationType.FREEHAND,
            path_points=[(1, 2), (3.5, 4)], color="#fff",
        )
        self.assertEqual(annotation.path_points, ((1.0, 2.0), (3.5, 4.0)))
        field_names = {field.name for field in dataclasses.fields(CanvasAnnotation)}
        self.assertTrue({"project_id", "owner_id", "path_points", "media_id"} <= field_names)
        self.assertTrue(field_names.isdisjoint({"node_id", "edge_id", "evidence", "approved", "approval"}))
        with self.assertRaises(ValueError):
            CanvasAnnotation.create(
                id="a", project_id="p", owner_id="o", annotation_type=AnnotationType.MEDIA,
                media_id="data:image/png;base64,AAAA",
            )

    def test_media_keeps_opaque_storage_metadata_only(self) -> None:
        media = CanvasMedia.create(
            id="m", project_id="p", owner_id="o", storage_key="01JOPAQUEKEY",
            mime_type="image/png", byte_length=12, sha256="a" * 64,
        )
        self.assertEqual(media.storage_key, "01JOPAQUEKEY")
        field_names = {field.name for field in dataclasses.fields(CanvasMedia)}
        self.assertTrue({"owner_id", "project_id", "mime_type", "byte_length", "sha256", "created_at", "updated_at"} <= field_names)
        self.assertTrue(field_names.isdisjoint({"path", "filesystem_path", "bucket", "bucket_path"}))
        for bad_key in ("/tmp/file.png", "bucket/file.png", "https://host/file.png", "data:image/png;base64,x"):
            with self.subTest(bad_key=bad_key), self.assertRaises(ValueError):
                CanvasMedia.create(id="m", project_id="p", owner_id="o", storage_key=bad_key, mime_type="image/png", byte_length=1, sha256="b" * 64)
        with self.assertRaises(ValueError):
            CanvasMedia.create(id="m", project_id="p", owner_id="o", storage_key="opaque", mime_type="image/png", byte_length=0, sha256="bad")


if __name__ == "__main__":
    unittest.main()
