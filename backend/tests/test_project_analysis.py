from __future__ import annotations

from dataclasses import replace
import threading
import unittest

from pydantic import ValidationError

from app.llm.types import AllProvidersFailed, AttemptFailure
from app.llm.router import _validate_output
from app.llm.schemas import GraphAnalysisOutput
from app.projects.analysis import (
    GraphAnalysisService,
    analysis_fingerprint,
    select_analysis_context,
    summarize_branch,
)
from app.projects.service import ProjectService
from app.projects.store import (
    GraphItemNotFound, InMemoryProjectStore, ProjectNotFound, StoreFailure, VersionConflict,
)
from app.projects.types import CreationSource, GraphEdge, GraphNode, ProposalState


class FakeReadiness:
    def __init__(self, route=("openrouter", "test/model")) -> None:
        self.route = route

    def require_configured(self, user_id: str) -> None:
        del user_id

    def analysis_route(self, user_id: str) -> tuple[str, str]:
        del user_id
        return self.route


class CountingRouter:
    def __init__(self, output: GraphAnalysisOutput) -> None:
        self.output = output
        self.calls = 0
        self.payloads: list[dict] = []

    def generate(self, user_id, output_model, system_prompt, user_json):
        del user_id, output_model, system_prompt
        self.calls += 1
        self.payloads.append(user_json)
        return self.output


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
                "dependencies": ("audience",), "confidence": 72,
                "downstream_effect": "Positioning may need revision.",
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


class GraphAnalysisServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = InMemoryProjectStore()
        self.projects = ProjectService(self.store)
        self.project = self.projects.create_project("user-a", "Northstar")
        self.selected = self.projects.create_node(
            "user-a", self.project.id, "assumption", "Audience", "Busy founders",
            "user", self.project.version, tags=("section:audience", "branch:founders"),
        )
        self.output = GraphAnalysisOutput.model_validate({
            "summary": "Test audience evidence.",
            "proposed_nodes": ({"client_key": "challenge-a", "node_type": "challenge",
                "title": "Validate audience", "content": "Evidence is thin.",
                "rationale": "Positioning depends on this.", "dependencies": (self.selected.id,),
                "confidence": 80, "downstream_effect": "Positioning may weaken."},),
            "proposed_edges": ({"source_key": "challenge-a", "target_key": self.selected.id,
                "edge_type": "contradicts"},),
            "affected_node_ids": (self.selected.id,),
        }, strict=True)
        self.router = CountingRouter(self.output)
        self.analysis = GraphAnalysisService(self.store, self.router, FakeReadiness())

    def test_unchanged_analysis_reuses_exact_proposal_without_router_call(self) -> None:
        first = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        second = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        self.assertEqual(first, second)
        self.assertEqual(self.router.calls, 1)
        self.assertEqual(len(self.store.list_proposals("user-a", self.project.id)), 1)

    def test_accepted_hermes_nodes_inherit_validated_section_and_branch_scope(self) -> None:
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        current = self.store.get_project("user-a", self.project.id); assert current is not None
        accepted = self.analysis.accept("user-a", self.project.id, result["proposal"]["id"], current.version)
        self.assertEqual(accepted["nodes"][0]["tags"], ("branch:founders", "section:audience"))

    def test_invalid_challenge_dependencies_never_persist_a_proposal(self) -> None:
        for dependencies in (("unknown",), (self.selected.id, self.selected.id), ("challenge-a",)):
            with self.subTest(dependencies=dependencies):
                candidate = self.output.model_dump(mode="python")
                candidate["proposed_nodes"][0]["dependencies"] = dependencies
                self.router.output = GraphAnalysisOutput.model_validate(candidate, strict=True)
                before = self.projects.get_graph("user-a", self.project.id)
                with self.assertRaises(ValueError):
                    self.analysis.analyze("user-a", self.project.id, self.selected.id, "invalid")
                self.assertEqual(self.store.list_proposals("user-a", self.project.id), ())
                self.assertEqual(self.projects.get_graph("user-a", self.project.id), before)

    def test_idempotency_replays_same_request_and_rejects_key_reuse(self) -> None:
        first = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge",
                                      self.project.version + 1, "stable-request-key")
        replay = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge",
                                       self.project.version + 1, "stable-request-key")
        self.assertEqual(replay, first)
        self.assertEqual(self.router.calls, 1)
        with self.assertRaises(VersionConflict):
            self.analysis.analyze("user-a", self.project.id, self.selected.id, "readiness",
                                  self.project.version + 1, "stable-request-key")

    def test_completed_replay_rejects_tampered_candidate_dependencies_and_project(self) -> None:
        for field in ("summary", "dependencies", "project", "targets"):
            with self.subTest(field=field):
                key = f"tampered-replay-{field}"
                self.analysis.analyze(
                    "user-a", self.project.id, self.selected.id, "challenge",
                    self.project.version + 1, key,
                )
                stored = self.store._analysis_requests[("user-a", self.project.id, key)]["result"]
                if field == "summary":
                    stored["candidate"]["summary"] = "Tampered"
                elif field == "dependencies":
                    stored["proposal"]["dependency_node_versions"] = ()
                elif field == "project":
                    stored["proposal"]["project_id"] = "other-project"
                else:
                    stored["proposal"]["target_node_ids"] = ("other-node",)
                with self.assertRaises(StoreFailure):
                    self.analysis.analyze(
                        "user-a", self.project.id, self.selected.id, "challenge",
                        self.project.version + 1, key,
                    )

    def test_failed_provider_abandons_claim_and_same_key_retries_successfully(self) -> None:
        original = self.router.generate
        attempts = 0
        def flaky(*args):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise AllProvidersFailed((AttemptFailure("openrouter", "timeout"),))
            return original(*args)
        self.router.generate = flaky
        with self.assertRaises(AllProvidersFailed):
            self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge",
                                  self.project.version + 1, "retryable-provider-key")
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge",
                                       self.project.version + 1, "retryable-provider-key")
        replay = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge",
                                       self.project.version + 1, "retryable-provider-key")
        self.assertEqual(result, replay)
        self.assertEqual(attempts, 2)
        self.assertEqual(self.router.calls, 1)
        self.assertEqual(len(self.store.list_proposals("user-a", self.project.id)), 1)

    def test_concurrent_idempotency_never_calls_router_twice(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        original = self.router.generate
        def blocking(*args):
            entered.set()
            release.wait(2)
            return original(*args)
        self.router.generate = blocking
        results, errors = [], []
        def run():
            try:
                results.append(self.analysis.analyze("user-a", self.project.id, self.selected.id,
                    "challenge", self.project.version + 1, "concurrent-key"))
            except Exception as exc:
                errors.append(exc)
        first = threading.Thread(target=run); second = threading.Thread(target=run)
        first.start(); self.assertTrue(entered.wait(2)); second.start(); second.join(2)
        release.set(); first.join(2)
        self.assertEqual(self.router.calls, 1)
        self.assertEqual(len(results), 1)
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], VersionConflict)

    def test_terminal_proposal_reuses_cached_output_without_router(self) -> None:
        first = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        proposal = self.store.get_proposal("user-a", self.project.id, first["proposal"]["id"])
        assert proposal is not None
        self.store.update_proposal("user-a", replace(proposal, state=ProposalState.REJECTED, version=2), 1)
        second = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        self.assertEqual(self.router.calls, 1)
        self.assertNotEqual(first["proposal"]["id"], second["proposal"]["id"])
        self.assertEqual(second["proposal"]["state"], "pending")

        empty = GraphAnalysisOutput.model_validate({"summary": "No changes.", "proposed_nodes": (),
            "proposed_edges": (), "affected_node_ids": (self.selected.id,)}, strict=True)
        self.router.output = empty
        baseline = self.analysis.analyze("user-a", self.project.id, self.selected.id, "readiness")
        current = self.store.get_project("user-a", self.project.id); assert current is not None
        self.analysis.accept("user-a", self.project.id, baseline["proposal"]["id"], current.version)
        accepted_reuse = self.analysis.analyze("user-a", self.project.id, self.selected.id, "readiness")
        self.assertEqual(self.router.calls, 2)
        self.assertNotEqual(baseline["proposal"]["id"], accepted_reuse["proposal"]["id"])

    def test_reject_is_terminal_idempotent_and_never_mutates_graph(self) -> None:
        before = self.projects.get_graph("user-a", self.project.id)
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        rejected = self.analysis.reject("user-a", self.project.id, result["proposal"]["id"])
        self.assertEqual(rejected["state"], "rejected")
        self.assertEqual(self.analysis.reject("user-a", self.project.id, result["proposal"]["id"]), rejected)
        self.assertEqual(self.projects.get_graph("user-a", self.project.id), before)
        with self.assertRaises(VersionConflict):
            self.analysis.accept("user-a", self.project.id, result["proposal"]["id"], before["project"].version)

    def test_challenge_resolutions_are_owner_scoped_and_hydratable(self) -> None:
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        current = self.store.get_project("user-a", self.project.id); assert current is not None
        accepted = self.analysis.accept("user-a", self.project.id, result["proposal"]["id"], current.version)
        challenge_id = accepted["nodes"][0]["id"]
        current = self.store.get_project("user-a", self.project.id); assert current is not None
        saved = self.analysis.resolve_challenge("user-a", self.project.id, challenge_id, "deferred", "Need interviews", current.version)
        self.assertEqual(self.analysis.list_challenge_resolutions("user-a", self.project.id, challenge_id), (saved,))
        challenge = self.store.get_node("user-a", self.project.id, challenge_id); assert challenge is not None
        current = self.store.get_project("user-a", self.project.id); assert current is not None
        self.projects.update_node_semantics(
            "user-a", self.project.id, challenge_id, node_type="idea", title=challenge.title,
            content=challenge.content, state=challenge.state, created_by=challenge.created_by,
            provenance=challenge.provenance, tags=challenge.tags,
            expected_node_version=challenge.version, expected_project_version=current.version,
        )
        self.assertEqual(self.analysis.list_challenge_resolutions("user-a", self.project.id, challenge_id), (saved,))
        with self.assertRaises(ProjectNotFound):
            self.analysis.list_challenge_resolutions("user-b", self.project.id, challenge_id)

    def test_proposal_listing_rejects_corrupt_or_missing_candidate(self) -> None:
        from app.projects.store import StoreFailure
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        key = f"proposal:{result['proposal']['id']}"
        cached = self.store.get_analysis("user-a", self.project.id, key)
        assert cached is not None
        self.store.put_analysis("user-a", self.project.id, key, {**cached, "output": {"secret": "raw"}})
        with self.assertRaises(StoreFailure):
            self.analysis.list_proposals("user-a", self.project.id)
        self.assertNotIn("secret", repr(result))

    def test_only_relevant_semantic_dependency_invalidates_cache(self) -> None:
        first = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        graph_before = self.projects.get_graph("user-a", self.project.id)
        self.projects.save_layout("user-a", self.project.id, {self.selected.id: (8, 9)}, 0)
        self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        self.assertEqual(self.router.calls, 1)
        unrelated = self.projects.create_node(
            "user-a", self.project.id, "idea", "Logo", "A circle", "user",
            graph_before["project"].version,
        )
        self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        self.assertEqual(self.router.calls, 1)
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        self.projects.update_node("user-a", self.project.id, self.selected.id, "Audience", "Changed",
            self.selected.version, current.version)
        changed = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        self.assertNotEqual(first["proposal"]["id"], changed["proposal"]["id"])
        self.assertEqual(self.router.calls, 2)
        self.assertNotIn(unrelated.id, self.router.payloads[-1]["nodes"])
        self.assertNotIn("layout", self.router.payloads[-1])
        self.assertNotIn("annotations", self.router.payloads[-1])

    def test_preview_does_not_mutate_graph_and_accept_is_atomic_idempotent(self) -> None:
        before = self.projects.get_graph("user-a", self.project.id)
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        preview = self.projects.get_graph("user-a", self.project.id)
        self.assertEqual(preview["nodes"], before["nodes"])
        self.assertEqual(preview["edges"], before["edges"])
        accepted = self.analysis.accept(
            "user-a", self.project.id, result["proposal"]["id"], before["project"].version,
        )
        self.assertEqual(accepted["proposal"]["state"], ProposalState.ACCEPTED.value)
        self.assertEqual(len(accepted["nodes"]), 1)
        self.assertEqual(accepted["edges"][0]["source_node_id"], accepted["nodes"][0]["id"])
        repeated = self.analysis.accept("user-a", self.project.id, result["proposal"]["id"], 0)
        self.assertEqual(repeated, accepted)

    def test_accept_translates_proposed_challenge_dependency_keys_to_node_ids(self) -> None:
        self.router.output = GraphAnalysisOutput.model_validate({
            "summary": "Add proof and challenge.",
            "proposed_nodes": (
                {"client_key": "proof-a", "node_type": "evidence", "title": "Proof",
                 "content": "Interview evidence", "rationale": "Ground the claim."},
                {"client_key": "challenge-a", "node_type": "challenge", "title": "Test proof",
                 "content": "Confirm representativeness.", "rationale": "Avoid overclaiming.",
                 "dependencies": ("proof-a", self.selected.id), "confidence": 74,
                 "downstream_effect": "Positioning may narrow."},
            ),
            "proposed_edges": (), "affected_node_ids": (self.selected.id,),
        }, strict=True)
        before = self.projects.get_graph("user-a", self.project.id)
        proposal = self.analysis.analyze("user-a", self.project.id, self.selected.id, "dependency-translation")
        accepted = self.analysis.accept("user-a", self.project.id, proposal["proposal"]["id"], before["project"].version)
        proof = next(item for item in accepted["nodes"] if item["node_type"] == "evidence")
        challenge = next(item for item in accepted["nodes"] if item["node_type"] == "challenge")
        self.assertEqual(challenge["challenge_dependencies"], (proof["id"], self.selected.id))

    def test_accepted_retry_survives_later_dependency_edits_without_mutation(self) -> None:
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        related = self.projects.create_node(
            "user-a", self.project.id, "evidence", "Proof", "Interview", "user", current.version,
        )
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        dependency_edge = self.projects.connect_nodes(
            "user-a", self.project.id, self.selected.id, related.id, "supports", current.version,
        )
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        accepted = self.analysis.accept(
            "user-a", self.project.id, result["proposal"]["id"], current.version,
        )
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        selected = self.store.get_node("user-a", self.project.id, self.selected.id)
        assert selected is not None
        self.projects.update_node(
            "user-a", self.project.id, selected.id, selected.title, "Later node edit",
            selected.version, current.version,
        )
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        dependency_edge = self.store.get_edge("user-a", self.project.id, dependency_edge.id)
        assert dependency_edge is not None
        self.projects.update_relationship(
            "user-a", self.project.id, dependency_edge.id, dependency_edge.edge_type,
            "Later edge edit", dependency_edge.version, current.version,
        )
        before_retry = self.projects.get_graph("user-a", self.project.id)
        repeated = self.analysis.accept(
            "user-a", self.project.id, result["proposal"]["id"], -999,
        )
        after_retry = self.projects.get_graph("user-a", self.project.id)
        self.assertEqual(repeated, accepted)
        self.assertEqual(after_retry, before_retry)

    def test_stale_acceptance_and_owner_isolation(self) -> None:
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        with self.assertRaises(VersionConflict):
            self.analysis.accept("user-a", self.project.id, result["proposal"]["id"], 99)
        with self.assertRaises(ProjectNotFound):
            self.analysis.accept("user-b", self.project.id, result["proposal"]["id"], self.project.version)

    def test_accept_rejects_stale_dependency_node_even_with_current_project_version(self) -> None:
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        self.projects.update_node(
            "user-a", self.project.id, self.selected.id, "Audience", "Changed after preview",
            self.selected.version, current.version,
        )
        latest = self.store.get_project("user-a", self.project.id)
        assert latest is not None
        with self.assertRaises(VersionConflict):
            self.analysis.accept("user-a", self.project.id, result["proposal"]["id"], latest.version)

    def test_accept_rejects_stale_dependency_edge_even_with_current_project_version(self) -> None:
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        related = self.projects.create_node(
            "user-a", self.project.id, "evidence", "Proof", "Interview", "user", current.version,
        )
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        edge = self.projects.connect_nodes(
            "user-a", self.project.id, self.selected.id, related.id, "supports", current.version,
        )
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        self.projects.update_relationship(
            "user-a", self.project.id, edge.id, "supports", "Changed after preview",
            edge.version, current.version,
        )
        latest = self.store.get_project("user-a", self.project.id)
        assert latest is not None
        with self.assertRaises(VersionConflict):
            self.analysis.accept("user-a", self.project.id, result["proposal"]["id"], latest.version)

    def test_candidate_hash_rejects_cache_corruption_on_list_and_accept(self) -> None:
        result = self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        cache_key, cached = next(
            item for item in self.store.list_analyses("user-a", self.project.id)
            if item[0] == f"proposal:{result['proposal']['id']}"
        )
        cached["output"]["summary"] = "Injected cache mutation"
        self.store.put_analysis("user-a", self.project.id, cache_key, cached)
        with self.assertRaises(StoreFailure):
            self.analysis.list_proposals("user-a", self.project.id)
        with self.assertRaises(StoreFailure):
            self.analysis.accept(
                "user-a", self.project.id, result["proposal"]["id"],
                self.store.get_project("user-a", self.project.id).version,  # type: ignore[union-attr]
            )

    def test_invalid_proposal_reference_never_persists_or_mutates(self) -> None:
        invalid = GraphAnalysisOutput.model_validate({
            **self.output.model_dump(),
            "proposed_edges": ({"source_key": "missing", "target_key": self.selected.id,
                                "edge_type": "supports"},),
        }, strict=True)
        self.router.output = invalid
        before = self.projects.get_graph("user-a", self.project.id)
        with self.assertRaises(ValueError):
            self.analysis.analyze("user-a", self.project.id, self.selected.id, "challenge")
        after = self.projects.get_graph("user-a", self.project.id)
        self.assertEqual((after["nodes"], after["edges"]), (before["nodes"], before["edges"]))
        self.assertEqual(self.store.list_proposals("user-a", self.project.id), ())

    def test_challenge_resolution_is_terminal_and_rejects_second_choice(self) -> None:
        project = self.store.get_project("user-a", self.project.id)
        assert project is not None
        challenge = self.projects.create_node("user-a", self.project.id, "challenge", "Risk", "Why?",
            "hermes", project.version)
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        record = self.analysis.resolve_challenge(
            "user-a", self.project.id, challenge.id, "resolved", "Added evidence", current.version,
        )
        self.assertEqual(record["state"], "resolved")
        current = self.store.get_project("user-a", self.project.id)
        assert current is not None
        with self.assertRaises(VersionConflict):
            self.analysis.resolve_challenge(
                "user-a", self.project.id, challenge.id, "overridden", "Contradiction", current.version,
            )
        self.assertEqual(len(self.store.list_challenge_resolutions("user-a", self.project.id, challenge.id)), 1)


if __name__ == "__main__":
    unittest.main()
