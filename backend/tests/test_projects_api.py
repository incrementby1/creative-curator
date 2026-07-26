from __future__ import annotations

from dataclasses import replace
import unittest
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth.identity import InvalidAccessToken, UserIdentity, get_identity_verifier
from app.projects.store import StoreFailure
from app.main import app


class FakeVerifier:
    def verify(self, token: str) -> UserIdentity:
        if token in {"valid-a", "valid-b"}:
            suffix = token[-1]
            return UserIdentity(f"user-{suffix}", f"{suffix}@example.test")
        raise InvalidAccessToken("secret invalid token detail")


class ProjectsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        from app.llm.schemas import GraphAnalysisOutput
        from app.projects.analysis import GraphAnalysisService
        from app.projects.blueprint import BlueprintCompiler
        from app.projects.service import ProjectService
        from app.projects.store import InMemoryProjectStore

        self.previous_verifier = app.dependency_overrides.get(get_identity_verifier)
        self.store = InMemoryProjectStore()
        self.service = ProjectService(self.store)
        class Ready:
            def require_configured(self, user_id): del user_id
            def analysis_route(self, user_id): del user_id; return ("test", "graph-v1")
        class Router:
            def generate(inner, user_id, output_model, system_prompt, user_json):
                del inner, user_id, output_model, system_prompt
                selected = user_json["selected_node_id"]
                return GraphAnalysisOutput.model_validate({
                    "summary": "Challenge this assumption.",
                    "proposed_nodes": ({"client_key": "new-challenge", "node_type": "challenge",
                        "title": "Validate claim", "content": "Evidence is missing.",
                        "rationale": "This decision depends on proof.", "dependencies": (selected,),
                        "confidence": 85, "downstream_effect": "Approval may be premature."},),
                    "proposed_edges": ({"source_key": "new-challenge", "target_key": selected,
                        "edge_type": "contradicts"},), "affected_node_ids": (selected,),
                }, strict=True)
        self.analysis_service = GraphAnalysisService(self.store, Router(), Ready())
        self.blueprint_compiler = BlueprintCompiler(self.store)
        app.dependency_overrides[get_identity_verifier] = FakeVerifier
        try:
            from app.api.projects import get_project_service
        except ModuleNotFoundError:
            self.get_project_service = None
            self.previous_service = None
        else:
            self.get_project_service = get_project_service
            self.previous_service = app.dependency_overrides.get(get_project_service)
            app.dependency_overrides[get_project_service] = lambda: self.service
            from app.api.projects import get_graph_analysis_service
            self.get_analysis_service = get_graph_analysis_service
            self.previous_analysis_service = app.dependency_overrides.get(get_graph_analysis_service)
            app.dependency_overrides[get_graph_analysis_service] = lambda: self.analysis_service
            from app.api.projects import get_blueprint_compiler
            self.get_blueprint_compiler = get_blueprint_compiler
            self.previous_blueprint_compiler = app.dependency_overrides.get(get_blueprint_compiler)
            app.dependency_overrides[get_blueprint_compiler] = lambda: self.blueprint_compiler
        self.client = TestClient(app)

    def tearDown(self) -> None:
        dependencies = [(get_identity_verifier, self.previous_verifier)]
        if self.get_project_service is not None:
            dependencies.append((self.get_project_service, self.previous_service))
            dependencies.append((self.get_analysis_service, self.previous_analysis_service))
            dependencies.append((self.get_blueprint_compiler, self.previous_blueprint_compiler))
        for dependency, previous in dependencies:
            if previous is None:
                app.dependency_overrides.pop(dependency, None)
            else:
                app.dependency_overrides[dependency] = previous

    @staticmethod
    def auth(token: str = "valid-a") -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def create_project(self, title: str = "Northstar") -> dict:
        response = self.client.post("/projects", headers=self.auth(), json={"title": title})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def create_node(self, project: dict, node_type: str = "idea") -> dict:
        response = self.client.post(
            f"/projects/{project['id']}/nodes", headers=self.auth(),
            json={"node_type": node_type, "title": "First thought", "content": "Useful detail",
                  "created_by": "user", "provenance": "customer interview", "tags": ["signal"],
                  "expected_project_version": project["version"]},
        )
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        self.assertEqual(result["provenance"], "customer interview")
        self.assertEqual(result["tags"], ["signal"])
        return result

    def test_semantic_mutation_idempotency_replays_exact_result_and_releases_failure(self) -> None:
        project = self.create_project()
        payload = {"node_type": "idea", "title": "Queued thought", "content": "Exact payload",
                   "created_by": "user", "provenance": "offline", "tags": [],
                   "expected_project_version": project["version"]}
        headers = {**self.auth(), "Idempotency-Key": "queued-edit-0001"}
        first = self.client.post(f"/projects/{project['id']}/nodes", headers=headers, json=payload)
        self.assertEqual(len(self.store._analysis_requests), 1)  # type: ignore[attr-defined]
        replay = self.client.post(f"/projects/{project['id']}/nodes", headers=headers, json=payload)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(replay.status_code, 201, replay.text)
        self.assertEqual(replay.json(), first.json())
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        self.assertEqual(graph["project"]["version"], project["version"] + 1)
        self.assertEqual(len(graph["nodes"]), 1)
        mismatch = self.client.post(f"/projects/{project['id']}/nodes", headers=headers,
                                    json={**payload, "title": "Different"})
        self.assertEqual(mismatch.status_code, 409)

        failed_headers = {**self.auth(), "Idempotency-Key": "queued-edit-0002"}
        stale = self.client.post(f"/projects/{project['id']}/nodes", headers=failed_headers,
                                 json={**payload, "expected_project_version": 0, "title": "After failure"})
        self.assertEqual(stale.status_code, 409)
        retried = self.client.post(f"/projects/{project['id']}/nodes", headers=failed_headers,
                                   json={**payload, "expected_project_version": project["version"] + 1, "title": "After failure"})
        self.assertEqual(retried.status_code, 201, retried.text)

    def test_post_commit_response_failure_retries_exactly_without_second_mutation(self) -> None:
        project = self.create_project()
        payload = {"node_type": "idea", "title": "Committed once", "content": "Retry safely",
                   "created_by": "user", "provenance": "offline", "tags": [],
                   "expected_project_version": project["version"]}
        headers = {**self.auth(), "Idempotency-Key": "post-commit-failure-01"}
        original = self.store.commit_idempotent_mutation
        failed = False

        def lose_response(*args, **kwargs):
            nonlocal failed
            result = original(*args, **kwargs)
            if not failed:
                failed = True
                raise StoreFailure("response lost after commit")
            return result

        self.store.commit_idempotent_mutation = lose_response  # type: ignore[method-assign]
        first = self.client.post(f"/projects/{project['id']}/nodes", headers=headers, json=payload)
        retry = self.client.post(f"/projects/{project['id']}/nodes", headers=headers, json=payload)
        self.assertEqual(first.status_code, 503)
        self.assertEqual(retry.status_code, 201, retry.text)
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        self.assertEqual(graph["project"]["version"], project["version"] + 1)
        self.assertEqual(graph["nodes"], [retry.json()])

    def test_trash_and_restore_require_atomic_project_and_node_versions(self) -> None:
        project = self.create_project(); node = self.create_node(project)
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        path = f"/projects/{project['id']}/nodes/{node['id']}"
        stale = self.client.post(f"{path}/trash", headers=self.auth(), json={"expected_node_version": node["version"], "expected_project_version": project["version"]})
        self.assertEqual(stale.status_code, 409)
        trashed = self.client.post(f"{path}/trash", headers=self.auth(), json={"expected_node_version": node["version"], "expected_project_version": graph["project"]["version"]})
        self.assertEqual(trashed.status_code, 200, trashed.text)
        restore_stale = self.client.post(f"{path}/restore", headers=self.auth(), json={"expected_node_version": trashed.json()["version"], "expected_project_version": graph["project"]["version"]})
        self.assertEqual(restore_stale.status_code, 409)
        latest = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        restored = self.client.post(f"{path}/restore", headers=self.auth(), json={"expected_node_version": trashed.json()["version"], "expected_project_version": latest["project"]["version"]})
        self.assertEqual(restored.status_code, 200, restored.text)

    def test_every_route_requires_valid_authentication(self) -> None:
        requests = (
            ("POST", "/projects", {"title": "x"}), ("GET", "/projects", None),
            ("GET", "/projects/summaries", None),
            ("GET", "/projects/p", None), ("POST", "/projects/p/nodes", {}),
            ("PATCH", "/projects/p/nodes/n", {}), ("POST", "/projects/p/edges", {}),
            ("PATCH", "/projects/p/edges/e", {}), ("DELETE", "/projects/p/edges/e", None),
            ("POST", "/projects/p/nodes/n/trash", {}), ("POST", "/projects/p/nodes/n/restore", {}),
            ("POST", "/projects/p/nodes/n/approve", {}), ("PUT", "/projects/p/layout", {}),
            ("PUT", "/projects/p/annotations", {}), ("POST", "/projects/p/media", None),
            ("GET", "/projects/p/media/m", None), ("DELETE", "/projects/p/media/m", None),
            ("PUT", "/projects/p/theme", {}), ("PUT", "/users/me/theme", {}),
            ("GET", "/projects/p/revisions/n", None),
            ("POST", "/projects/p/analysis", {}), ("GET", "/projects/p/proposals", None),
            ("POST", "/projects/p/proposals/x/accept", {}),
            ("POST", "/projects/p/challenges/x/resolve", {}),
            ("GET", "/projects/p/summary", None),
            ("GET", "/projects/p/blueprint/readiness", None),
            ("POST", "/projects/p/blueprints", {}),
            ("GET", "/projects/p/blueprints", None),
            ("GET", "/projects/p/blueprints/x", None),
        )
        for method, path, body in requests:
            for headers in ({}, self.auth("invalid-secret")):
                with self.subTest(method=method, path=path, headers=headers):
                    response = self.client.request(method, path, headers=headers, json=body)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.headers["www-authenticate"], "Bearer")
                    self.assertNotIn("invalid-secret", response.text)

    def test_project_node_owner_isolation_and_conflict_contract(self) -> None:
        project = self.create_project("Secret brand")
        self.assertEqual(project["title"], "Secret brand")
        self.assertEqual(project["version"], 1)
        self.assertEqual(self.client.get("/projects", headers=self.auth()).json(), [project])
        hidden = self.client.get(f"/projects/{project['id']}", headers=self.auth("valid-b"))
        self.assertEqual(hidden.status_code, 404)
        self.assertEqual(hidden.json(), {"detail": "Project not found."})

        node = self.create_node(project)
        self.assertEqual(node["version"], 1)
        stale = self.client.patch(
            f"/projects/{project['id']}/nodes/{node['id']}", headers=self.auth(),
            json={"node_type": "idea", "title": "Changed", "content": "Still useful",
                  "state": "working", "created_by": "user", "provenance": None, "tags": [],
                  "expected_node_version": 0, "expected_project_version": 2},
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json(), {"detail": {"code": "version_conflict"}})

    def test_blueprint_readiness_snapshot_history_and_owner_isolation(self) -> None:
        project = self.create_project("Blueprint brand")
        readiness = self.client.get(
            f"/projects/{project['id']}/blueprint/readiness", headers=self.auth(),
        )
        self.assertEqual(readiness.status_code, 200, readiness.text)
        self.assertFalse(readiness.json()["ready"])
        created = self.client.post(
            f"/projects/{project['id']}/blueprints", headers=self.auth(),
            json={"expected_project_version": project["version"]},
        )
        self.assertEqual(created.status_code, 201, created.text)
        snapshot = created.json()
        self.assertEqual(snapshot["project_title"], "Blueprint brand")
        self.assertEqual(snapshot["project_version"], 1)
        self.assertEqual(snapshot["sequence"], 1)
        self.assertEqual(len(snapshot["sections"]), 11)
        replay = self.client.post(
            f"/projects/{project['id']}/blueprints", headers=self.auth(),
            json={"expected_project_version": project["version"]},
        )
        self.assertEqual(replay.json(), snapshot)
        listed = self.client.get(f"/projects/{project['id']}/blueprints", headers=self.auth())
        self.assertEqual(listed.json(), [snapshot])
        loaded = self.client.get(
            f"/projects/{project['id']}/blueprints/{snapshot['id']}", headers=self.auth(),
        )
        self.assertEqual(loaded.json(), snapshot)
        current = self.store.get_project("user-a", project["id"])
        self.store.update_project("user-a", replace(current, title="Renamed later", version=2), 1)
        historical = self.client.get(
            f"/projects/{project['id']}/blueprints/{snapshot['id']}", headers=self.auth(),
        )
        self.assertEqual(historical.json()["project_title"], "Blueprint brand")
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/blueprints", headers=self.auth("valid-b"),
        ).status_code, 404)

    def test_project_summary_excludes_terminal_challenges_and_is_owner_scoped(self) -> None:
        from app.projects.types import ChallengeResolution, ChallengeState, GraphNode

        project = self.create_project("Summary brand")
        open_challenge = GraphNode.create(
            project["id"], "challenge", "Open", "Still unresolved", "user",
        )
        self.store.commit_node_creation("user-a", open_challenge, 1)
        terminal_states = (
            ChallengeState.RESOLVED, ChallengeState.DEFERRED, ChallengeState.OVERRIDDEN,
        )
        terminal_challenges = []
        for offset, state in enumerate(terminal_states, start=2):
            challenge = GraphNode.create(
                project["id"], "challenge", state.value, f"Explicitly {state.value}", "user",
            )
            self.store.commit_node_creation("user-a", challenge, offset)
            terminal_challenges.append((challenge, state))
        for offset, (challenge, state) in enumerate(terminal_challenges, start=5):
            resolution = ChallengeResolution.resolve(
                project_id=project["id"], challenge_id=challenge.id,
                resolution="Accepted tradeoff", state=state, resolved_by="user-a",
            )
            self.store.commit_challenge_resolution("user-a", resolution, offset)

        summary = self.client.get(f"/projects/{project['id']}/summary", headers=self.auth())
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertEqual(summary.json()["unresolved_challenge_count"], 1)
        self.assertEqual(summary.json()["project_version"], 8)
        hidden = self.client.get(
            f"/projects/{project['id']}/summary", headers=self.auth("valid-b"),
        )
        self.assertEqual(hidden.status_code, 404)
        self.assertEqual(hidden.json(), {"detail": "Project not found."})

    def test_project_summaries_are_bounded_batched_and_owner_scoped(self) -> None:
        from unittest.mock import Mock

        own = [self.service.create_project("user-a", f"Brand {index}") for index in range(4)]
        self.service.create_project("user-b", "Foreign")
        project_page = self.client.get("/projects?limit=2", headers=self.auth())
        self.assertEqual(
            [item["id"] for item in project_page.json()], sorted(item.id for item in own)[:2],
        )
        self.assertEqual(self.client.get("/projects?limit=101", headers=self.auth()).status_code, 422)
        original = self.store.list_project_summary_inputs
        self.store.list_project_summary_inputs = Mock(wraps=original)  # type: ignore[method-assign]
        self.store.list_nodes = Mock(side_effect=AssertionError("N+1 node read"))  # type: ignore[method-assign]
        self.store.list_challenge_resolutions = Mock(side_effect=AssertionError("N+1 resolution read"))  # type: ignore[method-assign]

        response = self.client.get("/projects/summaries?limit=3", headers=self.auth())
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertEqual(len(rows), 3)
        self.assertEqual([row["project"]["id"] for row in rows], sorted(item.id for item in own)[:3])
        self.assertTrue(all(row["project"]["owner_id"] == "user-a" for row in rows))
        self.store.list_project_summary_inputs.assert_called_once_with("user-a", 3)
        self.store.list_nodes.assert_not_called()
        self.store.list_challenge_resolutions.assert_not_called()

        foreign = self.client.get("/projects/summaries?limit=100", headers=self.auth("valid-b"))
        self.assertEqual([row["project"]["title"] for row in foreign.json()], ["Foreign"])
        oversized = self.client.get("/projects/summaries?limit=101", headers=self.auth())
        self.assertEqual(oversized.status_code, 422)

    def test_analysis_proposal_acceptance_listing_and_challenge_resolution(self) -> None:
        project = self.create_project()
        node = self.create_node(project, "assumption")
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        analyzed = self.client.post(f"/projects/{project['id']}/analysis", headers=self.auth(), json={
            "selected_node_id": node["id"], "analysis_type": "challenge",
            "expected_project_version": graph["project"]["version"],
            "idempotency_key": "analysis-request-0001",
        })
        self.assertEqual(analyzed.status_code, 200, analyzed.text)
        proposal = analyzed.json()["proposal"]
        replayed = self.client.post(f"/projects/{project['id']}/analysis", headers=self.auth(), json={
            "selected_node_id": node["id"], "analysis_type": "challenge",
            "expected_project_version": graph["project"]["version"],
            "idempotency_key": "analysis-request-0001",
        })
        self.assertEqual(replayed.json(), analyzed.json())
        reused = self.client.post(f"/projects/{project['id']}/analysis", headers=self.auth(), json={
            "selected_node_id": node["id"], "analysis_type": "readiness",
            "expected_project_version": graph["project"]["version"],
            "idempotency_key": "analysis-request-0001",
        })
        self.assertEqual(reused.status_code, 409)
        self.assertEqual(reused.json()["detail"], {"code": "version_conflict"})
        listed = self.client.get(f"/projects/{project['id']}/proposals", headers=self.auth())
        self.assertEqual([item["id"] for item in listed.json()], [proposal["id"]])
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/proposals", headers=self.auth("valid-b")
        ).status_code, 404)
        rejected = self.client.post(f"/projects/{project['id']}/proposals/{proposal['id']}/reject", headers=self.auth())
        self.assertEqual(rejected.status_code, 200, rejected.text)
        self.assertEqual(rejected.json()["state"], "rejected")
        self.assertEqual(self.client.post(f"/projects/{project['id']}/proposals/{proposal['id']}/reject", headers=self.auth()).json(), rejected.json())
        self.assertEqual(self.client.get(f"/projects/{project['id']}/proposals", headers=self.auth()).json(), [])
        analyzed = self.client.post(f"/projects/{project['id']}/analysis", headers=self.auth(), json={
            "selected_node_id": node["id"], "analysis_type": "challenge-2",
            "expected_project_version": graph["project"]["version"], "idempotency_key": "analysis-request-0004",
        })
        proposal = analyzed.json()["proposal"]
        accepted = self.client.post(
            f"/projects/{project['id']}/proposals/{proposal['id']}/accept", headers=self.auth(),
            json={"expected_project_version": graph["project"]["version"]},
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["proposal"]["state"], "accepted")
        repeated = self.client.post(
            f"/projects/{project['id']}/proposals/{proposal['id']}/accept", headers=self.auth(),
            json={"expected_project_version": 0},
        )
        self.assertEqual(repeated.status_code, 200, repeated.text)
        challenge = accepted.json()["nodes"][0]
        self.assertEqual(challenge["challenge_dependencies"], [node["id"]])
        self.assertEqual(challenge["challenge_confidence"], 85)
        self.assertEqual(challenge["challenge_downstream_effect"], "Approval may be premature.")
        current = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        edited = self.client.patch(f"/projects/{project['id']}/nodes/{challenge['id']}", headers=self.auth(), json={
            "node_type": "challenge", "title": "Validate claim now", "content": challenge["content"],
            "state": "working", "created_by": "hermes", "provenance": challenge["provenance"],
            "tags": challenge["tags"], "expected_node_version": challenge["version"],
            "expected_project_version": current["project"]["version"],
        })
        self.assertEqual(edited.status_code, 200, edited.text)
        challenge = edited.json()
        self.assertEqual(challenge["challenge_dependencies"], [node["id"]])
        self.assertEqual(challenge["challenge_confidence"], 85)
        revisions = self.client.get(f"/projects/{project['id']}/revisions/{challenge['id']}", headers=self.auth()).json()
        self.assertEqual(revisions[-1]["challenge_dependencies"], [node["id"]])
        self.assertEqual(revisions[-1]["challenge_confidence"], 85)
        current = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        resolved = self.client.post(
            f"/projects/{project['id']}/challenges/{challenge['id']}/resolve", headers=self.auth(),
            json={"state": "overridden", "resolution": "Accept known tradeoff",
                  "expected_project_version": current["project"]["version"]},
        )
        self.assertEqual(resolved.status_code, 200, resolved.text)
        self.assertEqual(resolved.json()["state"], "overridden")
        history = self.client.get(f"/projects/{project['id']}/challenges/{challenge['id']}/resolutions", headers=self.auth())
        self.assertEqual(history.json(), [resolved.json()])
        self.assertEqual(self.client.get(f"/projects/{project['id']}/challenges/{challenge['id']}/resolutions", headers=self.auth("valid-b")).status_code, 404)
        current = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        contradictory = self.client.post(
            f"/projects/{project['id']}/challenges/{challenge['id']}/resolve", headers=self.auth(),
            json={"state": "resolved", "resolution": "Contradictory second terminal choice",
                  "expected_project_version": current["project"]["version"]},
        )
        self.assertEqual(contradictory.status_code, 409, contradictory.text)

    def test_analysis_stale_and_owner_safe_errors(self) -> None:
        project = self.create_project()
        node = self.create_node(project)
        stale = self.client.post(f"/projects/{project['id']}/analysis", headers=self.auth(), json={
            "selected_node_id": node["id"], "analysis_type": "challenge",
            "expected_project_version": 0, "idempotency_key": "analysis-request-0002",
        })
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["detail"], {"code": "version_conflict"})
        hidden = self.client.post(f"/projects/{project['id']}/analysis", headers=self.auth("valid-b"), json={
            "selected_node_id": node["id"], "analysis_type": "challenge",
            "expected_project_version": 2, "idempotency_key": "analysis-request-0003",
        })
        self.assertEqual(hidden.status_code, 404)

    def test_invalid_challenge_dependency_output_is_safe_and_not_persisted(self) -> None:
        from app.llm.schemas import GraphAnalysisOutput
        project = self.create_project(); node = self.create_node(project)
        current = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()["project"]
        router = self.analysis_service._router; original = router.generate
        router.generate = lambda *_args: GraphAnalysisOutput.model_validate({
            "summary": "Unsafe dependency", "proposed_nodes": ({"client_key": "challenge-x",
                "node_type": "challenge", "title": "Unknown dependency", "content": "Invalid",
                "rationale": "Must reject", "dependencies": ("not-in-context",), "confidence": 50,
                "downstream_effect": "Unknown"},), "proposed_edges": (),
            "affected_node_ids": (node["id"],),
        }, strict=True)
        try:
            response = self.client.post(f"/projects/{project['id']}/analysis", headers=self.auth(), json={
                "selected_node_id": node["id"], "analysis_type": "challenge",
                "expected_project_version": current["version"], "idempotency_key": "invalid-dependency-output",
            })
        finally: router.generate = original
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"], {"code": "invalid_project_request"})
        self.assertEqual(self.store.list_proposals("user-a", project["id"]), ())
        self.assertEqual(self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()["project"]["version"], current["version"])

    def test_analysis_provider_errors_are_safe_and_typed(self) -> None:
        from app.llm.types import AiConfigurationRequired, AllProvidersFailed, AttemptFailure

        project = self.create_project()
        node = self.create_node(project)
        current = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()["project"]
        body = {"selected_node_id": node["id"], "analysis_type": "challenge",
                "expected_project_version": current["version"],
                "idempotency_key": "analysis-request-safe-errors"}

        class Failing:
            def __init__(self, error): self.error = error
            def analyze(self, *_args): raise self.error

        for error, status_code, code in (
            (AiConfigurationRequired(), 409, "ai_configuration_required"),
            (AllProvidersFailed((AttemptFailure("openrouter", "timeout"),)), 503, "all_providers_failed"),
        ):
            with self.subTest(code=code):
                failing = Failing(error)
                def dependency(): return failing
                app.dependency_overrides[self.get_analysis_service] = dependency
                response = self.client.post(f"/projects/{project['id']}/analysis",
                    headers=self.auth(), json=body)
                self.assertEqual(response.status_code, status_code)
                self.assertEqual(response.json()["detail"], {"code": code})
                self.assertNotIn("openrouter", response.text)
        app.dependency_overrides[self.get_analysis_service] = lambda: self.analysis_service

    def test_validation_is_bounded_and_never_echoes_content(self) -> None:
        secret = "super-secret-content"
        response = self.client.post(
            "/projects", headers=self.auth(), json={"title": secret * 1000},
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret, response.text)

    def test_edges_lifecycle_revisions_and_decision_approval(self) -> None:
        project = self.create_project()
        first = self.create_node(project)
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        project = graph["project"]
        second = self.create_node(project, "decision")
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        response = self.client.post(
            f"/projects/{project['id']}/edges", headers=self.auth(),
            json={"source_node_id": first["id"], "target_node_id": second["id"],
                  "edge_type": "supports", "label": "Evidence link",
                  "expected_project_version": graph["project"]["version"]},
        )
        self.assertEqual(response.status_code, 201, response.text)
        edge = response.json()
        self.assertEqual(edge["label"], "Evidence link")
        creation_version = graph["project"]["version"]
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        self.assertEqual(graph["project"]["version"], creation_version + 1)
        changed = self.client.patch(
            f"/projects/{project['id']}/edges/{edge['id']}", headers=self.auth(),
            json={"edge_type": "inspires", "label": "Prompted", "expected_edge_version": 1,
                  "expected_project_version": graph["project"]["version"]},
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        approved = self.client.post(
            f"/projects/{project['id']}/nodes/{second['id']}/approve", headers=self.auth(),
            json={"expected_node_version": 1},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["state"], "approved")
        revisions = self.client.get(
            f"/projects/{project['id']}/revisions/{second['id']}", headers=self.auth()
        )
        self.assertEqual(revisions.status_code, 200)
        self.assertEqual(len(revisions.json()), 1)
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        deleted = self.client.request(
            "DELETE", f"/projects/{project['id']}/edges/{edge['id']}", headers=self.auth(),
            json={"expected_edge_version": 2, "expected_project_version": graph["project"]["version"]},
        )
        self.assertEqual(deleted.status_code, 204, deleted.text)

    def test_layout_annotations_and_theme_are_separate_from_semantic_version(self) -> None:
        project = self.create_project()
        node = self.create_node(project)
        before = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        layout = self.client.put(
            f"/projects/{project['id']}/layout", headers=self.auth(),
            json={"expected_layout_version": 0, "positions": {node["id"]: [12.5, -4]},
                  "dimensions": {node["id"]: [288, 176]}},
        )
        self.assertEqual(layout.json(), {"version": 1})
        annotation = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 0, "annotations": [{"annotation_type": "freehand",
                  "path_points": [[0, 0], [1, 1]], "color": "#112233"}]},
        )
        self.assertEqual(annotation.json(), {"version": 1})
        after = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        self.assertEqual(after["project"]["version"], before["project"]["version"])
        self.assertEqual(after["layout_version"], 1)
        self.assertEqual(after["layout_dimensions"], {node["id"]: [288.0, 176.0]})
        self.assertEqual(after["annotation_version"], 1)

        stale = self.client.put(f"/projects/{project['id']}/layout", headers=self.auth(), json={
            "expected_layout_version": 0, "positions": {node["id"]: [1, 2]},
            "dimensions": {node["id"]: [200, 120]},
        })
        self.assertEqual(stale.status_code, 409)

        self.assertEqual(self.client.put("/users/me/theme", headers=self.auth(), json={"theme": "graphite"}).status_code, 204)
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        self.assertEqual((graph["theme"], graph["global_theme"], graph["project_theme"]), ("graphite", "graphite", None))
        self.assertEqual(self.client.put(f"/projects/{project['id']}/theme", headers=self.auth(), json={"theme": "project"}).status_code, 204)
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        self.assertEqual((graph["theme"], graph["global_theme"], graph["project_theme"]), ("project", "graphite", "project"))
        self.assertEqual(self.client.put(f"/projects/{project['id']}/theme", headers=self.auth(), json={"theme": None}).status_code, 204)
        self.assertEqual(self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()["theme"], "graphite")

    def test_media_upload_download_delete_and_safe_rejections(self) -> None:
        project = self.create_project()
        png = b"\x89PNG\r\n\x1a\n" + b"payload"
        uploaded = self.client.post(
            f"/projects/{project['id']}/media", headers={**self.auth(), "X-Filename": "logo.png", "Content-Type": "image/png"},
            content=png,
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        media = uploaded.json()
        self.assertIn("upload_claim", media)
        self.assertNotIn(media["upload_claim"], repr(self.store._media))
        self.assertNotIn(media["upload_claim"], repr(self.store._media_claims))
        read = self.client.get(f"/projects/{project['id']}/media/{media['id']}", headers=self.auth())
        self.assertEqual(read.content, png)
        self.assertEqual(read.headers["content-type"], "image/png")
        hidden = self.client.get(f"/projects/{project['id']}/media/{media['id']}", headers=self.auth("valid-b"))
        self.assertEqual(hidden.status_code, 404)

        spoof = self.client.post(
            f"/projects/{project['id']}/media", headers={**self.auth(), "X-Filename": "bad.png", "Content-Type": "image/png"},
            content=b"not an image",
        )
        self.assertEqual(spoof.status_code, 415)
        huge = self.client.post(
            f"/projects/{project['id']}/media", headers={**self.auth(), "X-Filename": "huge.png", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\n" + b"x" * (5 * 1024 * 1024),
        )
        self.assertEqual(huge.status_code, 413)
        self.assertEqual(len(self.store._media), 1)
        deleted = self.client.delete(f"/projects/{project['id']}/media/{media['id']}", headers=self.auth())
        self.assertEqual(deleted.status_code, 204)

    def test_failed_media_annotation_attachment_preserves_media_without_explicit_discard(self) -> None:
        project = self.create_project()
        png = b"\x89PNG\r\n\x1a\n" + b"orphan"
        uploaded = self.client.post(
            f"/projects/{project['id']}/media",
            headers={**self.auth(), "X-Filename": "orphan.png", "Content-Type": "image/png"},
            content=png,
        ).json()
        failed = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 1, "annotations": [{
                "annotation_type": "media", "media_id": uploaded["id"]
            }]},
        )
        self.assertEqual(failed.status_code, 409)
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/media/{uploaded['id']}", headers=self.auth()
        ).status_code, 200)

    def test_failed_media_annotation_attachment_discards_explicit_orphan(self) -> None:
        project = self.create_project()
        png = b"\x89PNG\r\n\x1a\n" + b"explicit-orphan"
        uploaded = self.client.post(
            f"/projects/{project['id']}/media",
            headers={**self.auth(), "X-Filename": "orphan.png", "Content-Type": "image/png"},
            content=png,
        ).json()
        failed = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 1, "discard_media_on_failure": [{
                      "media_id": uploaded["id"], "upload_claim": uploaded["upload_claim"]}],
                  "annotations": [{"annotation_type": "media", "media_id": uploaded["id"]}]},
        )
        self.assertEqual(failed.status_code, 409)
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/media/{uploaded['id']}", headers=self.auth()
        ).status_code, 404)

    def test_wrong_upload_claim_cannot_discard_media(self) -> None:
        project = self.create_project()
        uploaded = self.client.post(
            f"/projects/{project['id']}/media",
            headers={**self.auth(), "X-Filename": "safe.png", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nclaim",
        ).json()
        failed = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 1, "discard_media_on_failure": [{
                "media_id": uploaded["id"], "upload_claim": "wrong-claim-value-long-enough"
            }], "annotations": [{"annotation_type": "media", "media_id": uploaded["id"]}]},
        )
        self.assertEqual(failed.status_code, 409)
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/media/{uploaded['id']}", headers=self.auth()
        ).status_code, 200)

    def test_claimed_media_cleanup_does_not_depend_on_annotation_id(self) -> None:
        project = self.create_project()
        uploaded = self.client.post(
            f"/projects/{project['id']}/media",
            headers={**self.auth(), "X-Filename": "claimed.png", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nclaimed-id",
        ).json()
        failed = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 1, "discard_media_on_failure": [{
                "media_id": uploaded["id"], "upload_claim": uploaded["upload_claim"]
            }], "annotations": [{"id": str(uuid4()), "annotation_type": "media",
                "media_id": uploaded["id"], "version": 1,
                "created_at": "2026-07-27T00:00:00+00:00",
                "updated_at": "2026-07-27T00:00:00+00:00"}]},
        )
        self.assertEqual(failed.status_code, 409)
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/media/{uploaded['id']}", headers=self.auth()
        ).status_code, 404)

    def test_invalid_annotation_before_media_still_cleans_claimed_upload(self) -> None:
        project = self.create_project()
        uploaded = self.client.post(
            f"/projects/{project['id']}/media",
            headers={**self.auth(), "X-Filename": "ordered.png", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nordered",
        ).json()
        failed = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 0, "discard_media_on_failure": [{
                "media_id": uploaded["id"], "upload_claim": uploaded["upload_claim"]
            }], "annotations": [
                {"annotation_type": "freehand", "path_points": [[0, 0]], "color": "#000"},
                {"annotation_type": "media", "media_id": uploaded["id"]},
            ]},
        )
        self.assertEqual(failed.status_code, 422)
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/media/{uploaded['id']}", headers=self.auth()
        ).status_code, 404)

    def test_successful_attachment_consumes_claim_and_annotation_round_trips(self) -> None:
        project = self.create_project()
        uploaded = self.client.post(
            f"/projects/{project['id']}/media",
            headers={**self.auth(), "X-Filename": "attached.png", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nattached",
        ).json()
        attached = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 0, "annotations": [{
                "annotation_type": "media", "media_id": uploaded["id"]
            }]},
        )
        self.assertEqual(attached.status_code, 200, attached.text)
        graph = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        annotation = graph["annotations"][0]
        annotation["version"] += 1
        annotation["updated_at"] = (
            datetime.fromisoformat(annotation["updated_at"]) + timedelta(seconds=1)
        ).isoformat()
        round_trip = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 1, "annotations": [annotation]},
        )
        self.assertEqual(round_trip.status_code, 200, round_trip.text)
        detached = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 2, "annotations": []},
        )
        self.assertEqual(detached.status_code, 200)
        stale_claim = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 99, "discard_media_on_failure": [{
                "media_id": uploaded["id"], "upload_claim": uploaded["upload_claim"]
            }], "annotations": [{"annotation_type": "media", "media_id": uploaded["id"]}]},
        )
        self.assertEqual(stale_claim.status_code, 409)
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/media/{uploaded['id']}", headers=self.auth()
        ).status_code, 200)

    def test_annotation_metadata_is_bounded_without_echoing_values(self) -> None:
        project = self.create_project()
        secret = "annotation-secret"
        for field in ("id", "media_id", "created_at", "updated_at"):
            body = {"expected_annotation_version": 0, "annotations": [{
                "annotation_type": "freehand", "path_points": [[0, 0], [1, 1]],
                field: secret * 100,
            }]}
            response = self.client.put(
                f"/projects/{project['id']}/annotations", headers=self.auth(), json=body,
            )
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(secret, response.text)

    def test_bounded_stream_append_rejects_chunk_before_mutating_buffer(self) -> None:
        from app.api.projects import _append_bounded
        from fastapi import HTTPException

        target = bytearray(b"safe")
        with self.assertRaises(HTTPException) as raised:
            _append_bounded(target, b"x" * (5 * 1024 * 1024))
        self.assertEqual(raised.exception.status_code, 413)
        self.assertEqual(target, bytearray(b"safe"))

    def test_annotation_request_accepts_exact_aggregate_point_budget(self) -> None:
        from app.api.projects import AnnotationsRequest, MAX_ANNOTATION_PATH_POINTS

        points = [[float(index), 0.0] for index in range(MAX_ANNOTATION_PATH_POINTS // 5)]
        model = AnnotationsRequest.model_validate({
            "expected_annotation_version": 0,
            "annotations": [
                {"annotation_type": "freehand", "path_points": points, "color": "#000"}
                for _ in range(5)
            ],
        })
        self.assertEqual(sum(len(item.path_points) for item in model.annotations), MAX_ANNOTATION_PATH_POINTS)

    def test_annotation_request_rejects_aggregate_point_overflow_without_mutation(self) -> None:
        from app.api.projects import MAX_ANNOTATION_PATH_POINTS

        project = self.create_project()
        per_item = (MAX_ANNOTATION_PATH_POINTS // 6) + 1
        points = [[float(index), 0.0] for index in range(per_item)]
        response = self.client.put(
            f"/projects/{project['id']}/annotations", headers=self.auth(),
            json={"expected_annotation_version": 0, "annotations": [
                {"annotation_type": "freehand", "path_points": points, "color": "#000"}
                for _ in range(6)
            ]},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.store.get_annotations("user-a", project["id"]), (0, ()))

    def test_annotation_aggregate_budget_runs_before_nested_point_validation(self) -> None:
        from app.api.projects import AnnotationsRequest, MAX_ANNOTATION_PATH_POINTS
        from pydantic import ValidationError

        invalid_points = ["not-a-point"] * (MAX_ANNOTATION_PATH_POINTS + 1)
        with self.assertRaises(ValidationError) as raised:
            AnnotationsRequest.model_validate({
                "expected_annotation_version": 0,
                "annotations": [{"annotation_type": "freehand", "path_points": invalid_points}],
            })
        self.assertIn("annotation path point budget exceeded", str(raised.exception))
        self.assertNotIn("list_type", str(raised.exception))

    def test_annotation_content_length_over_body_cap_never_invokes_route(self) -> None:
        from app.main import MAX_ANNOTATION_BODY_BYTES

        project = self.create_project()
        response = self.client.put(
            f"/projects/{project['id']}/annotations", headers={
                **self.auth(), "Content-Length": str(MAX_ANNOTATION_BODY_BYTES + 1),
            }, content=b"{}",
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json(), {"detail": {"code": "annotation_payload_too_large"}})
        self.assertEqual(self.store.get_annotations("user-a", project["id"]), (0, ()))

    def test_annotation_body_chunk_cap_rejects_before_buffer_mutation(self) -> None:
        from app.main import MAX_ANNOTATION_BODY_BYTES, _append_annotation_body
        from app.main import AnnotationBodyTooLarge

        target = bytearray(b"safe")
        with self.assertRaises(AnnotationBodyTooLarge):
            _append_annotation_body(target, b"x" * MAX_ANNOTATION_BODY_BYTES)
        self.assertEqual(target, bytearray(b"safe"))


if __name__ == "__main__":
    unittest.main()
