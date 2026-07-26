from __future__ import annotations

from dataclasses import replace
import unittest

from pydantic import ValidationError

from app.llm.router import _validate_output
from app.llm.schemas import GraphAnalysisOutput
from app.projects.analysis import (
    analysis_fingerprint,
    select_analysis_context,
    summarize_branch,
)
from app.projects.types import CreationSource, GraphEdge, GraphNode


class ProjectAnalysisTests(unittest.TestCase):
    def node(self, node_id: str, *, version: int = 1, content: str | None = None) -> GraphNode:
        return replace(
            GraphNode.create("project-a", "idea", node_id.title(), content or f"Content {node_id}", CreationSource.USER),
            id=node_id,
            version=version,
        )

    def edge(self, edge_id: str, source: str, target: str, *, version: int = 1) -> GraphEdge:
        return replace(
            GraphEdge.create("project-a", source, target, "supports"),
            id=edge_id,
            version=version,
        )

    def graph(self) -> dict[str, tuple[object, ...]]:
        nodes = tuple(self.node(item) for item in (
            "audience", "positioning", "promise", "proof", "tone", "logo", "logo-color",
        ))
        edges = (
            self.edge("e1", "audience", "positioning"),
            self.edge("e2", "positioning", "promise"),
            self.edge("e3", "promise", "proof"),
            self.edge("e4", "proof", "tone"),
            self.edge("e5", "logo", "logo-color"),
        )
        return {"nodes": nodes, "edges": edges}

    def valid_output(self) -> dict[str, object]:
        return {
            "summary": "Challenge weak assumptions.",
            "proposed_nodes": ({
                "client_key": "challenge-1",
                "node_type": "challenge",
                "title": "Validate audience",
                "content": "Evidence remains thin.",
                "rationale": "Decision depends on this claim.",
            },),
            "proposed_edges": ({
                "source_key": "challenge-1",
                "target_key": "audience",
                "edge_type": "contradicts",
            },),
            "affected_node_ids": ("audience",),
        }

    def test_graph_output_is_strict_bounded_and_known_typed(self) -> None:
        output = GraphAnalysisOutput.model_validate(self.valid_output(), strict=True)
        self.assertEqual(output.proposed_nodes[0].node_type, "challenge")
        for field, value in (
            ("extra", True),
            ("affected_node_ids", (1,)),
            ("proposed_nodes", tuple(self.valid_output()["proposed_nodes"]) * 9),  # type: ignore[arg-type]
            ("proposed_edges", tuple(self.valid_output()["proposed_edges"]) * 13),  # type: ignore[arg-type]
        ):
            candidate = {**self.valid_output(), field: value}
            with self.subTest(field=field), self.assertRaises(ValidationError):
                GraphAnalysisOutput.model_validate(candidate, strict=True)
        for field, value in (("node_type", "output"), ("edge_type", "related_to")):
            candidate = self.valid_output()
            collection = "proposed_nodes" if field == "node_type" else "proposed_edges"
            item = {**candidate[collection][0], field: value}  # type: ignore[index]
            candidate[collection] = (item,)
            with self.subTest(field=field), self.assertRaises(ValidationError):
                GraphAnalysisOutput.model_validate(candidate, strict=True)

    def test_invalid_structured_output_does_not_mutate_graph(self) -> None:
        graph = self.graph()
        before = (graph["nodes"], graph["edges"])
        invalid = {**self.valid_output(), "summary": 7}
        with self.assertRaises(ValidationError):
            _validate_output(GraphAnalysisOutput, __import__("json").dumps(invalid))
        self.assertEqual((graph["nodes"], graph["edges"]), before)

    def test_context_contains_selected_neighborhood_not_entire_graph(self) -> None:
        context = select_analysis_context(self.graph(), selected_node_id="audience", max_nodes=24)
        self.assertIn("positioning", context.node_ids)
        self.assertNotIn("logo", context.node_ids)
        self.assertLessEqual(len(context.node_ids), 24)
        self.assertEqual(context.node_ids, ("audience", "positioning", "promise", "proof"))

    def test_context_is_breadth_depth_bounded_and_deterministic(self) -> None:
        center = self.node("center")
        neighbors = tuple(self.node(f"n-{index}") for index in range(8))
        leaves = tuple(self.node(f"leaf-{index}") for index in range(8))
        edges = tuple(
            edge
            for index in range(8)
            for edge in (
                self.edge(f"a-{index}", "center", f"n-{index}"),
                self.edge(f"b-{index}", f"n-{index}", f"leaf-{index}"),
            )
        )
        graph = {"nodes": tuple(reversed((center, *neighbors, *leaves))), "edges": tuple(reversed(edges))}
        first = select_analysis_context(graph, "center", max_nodes=6, max_depth=1, max_breadth=4)
        second = select_analysis_context(graph, "center", max_nodes=6, max_depth=1, max_breadth=4)
        self.assertEqual(first, second)
        self.assertEqual(first.node_ids, ("center", "n-0", "n-1", "n-2", "n-3"))
        self.assertFalse(any(node_id.startswith("leaf") for node_id in first.node_ids))

    def test_branch_summary_is_compact_deterministic_and_semantic(self) -> None:
        context = select_analysis_context(self.graph(), "audience")
        summary = summarize_branch(context, max_content_length=12)
        self.assertEqual(summary, summarize_branch(context, max_content_length=12))
        self.assertIn("audience", summary)
        self.assertIn("supports", summary)
        self.assertNotIn("created_at", summary)

    def test_fingerprint_tracks_semantic_dependencies_and_route_not_layout(self) -> None:
        context = select_analysis_context(self.graph(), "audience")
        kwargs = dict(
            analysis_type="challenge", provider="openai-api", model="gpt-test",
            prompt_version="graph-v1", schema_version="1",
        )
        baseline = analysis_fingerprint(context, **kwargs)
        moved_graph = {**self.graph(), "layout": {"audience": (999.0, 300.0)}}
        moved = analysis_fingerprint(select_analysis_context(moved_graph, "audience"), **kwargs)
        self.assertEqual(baseline, moved)
        changed_nodes = tuple(
            replace(node, version=2, content="Changed") if node.id == "audience" else node
            for node in self.graph()["nodes"]
        )
        changed = select_analysis_context({"nodes": changed_nodes, "edges": self.graph()["edges"]}, "audience")
        self.assertNotEqual(baseline, analysis_fingerprint(changed, **kwargs))
        self.assertNotEqual(baseline, analysis_fingerprint(context, **{**kwargs, "model": "other"}))


if __name__ == "__main__":
    unittest.main()
