from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth.identity import InvalidAccessToken, UserIdentity, get_identity_verifier
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
                        "rationale": "This decision depends on proof."},),
                    "proposed_edges": ({"source_key": "new-challenge", "target_key": selected,
                        "edge_type": "contradicts"},), "affected_node_ids": (selected,),
                }, strict=True)
        self.analysis_service = GraphAnalysisService(self.store, Router(), Ready())
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
        self.client = TestClient(app)

    def tearDown(self) -> None:
        dependencies = [(get_identity_verifier, self.previous_verifier)]
        if self.get_project_service is not None:
            dependencies.append((self.get_project_service, self.previous_service))
            dependencies.append((self.get_analysis_service, self.previous_analysis_service))
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

    def test_every_route_requires_valid_authentication(self) -> None:
        requests = (
            ("POST", "/projects", {"title": "x"}), ("GET", "/projects", None),
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
        listed = self.client.get(f"/projects/{project['id']}/proposals", headers=self.auth())
        self.assertEqual([item["id"] for item in listed.json()], [proposal["id"]])
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/proposals", headers=self.auth("valid-b")
        ).status_code, 404)
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
        current = self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()
        resolved = self.client.post(
            f"/projects/{project['id']}/challenges/{challenge['id']}/resolve", headers=self.auth(),
            json={"state": "overridden", "resolution": "Accept known tradeoff",
                  "expected_project_version": current["project"]["version"]},
        )
        self.assertEqual(resolved.status_code, 200, resolved.text)
        self.assertEqual(resolved.json()["state"], "overridden")

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
            json={"positions": {node["id"]: [12.5, -4]}},
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
        self.assertEqual(after["annotation_version"], 1)

        self.assertEqual(self.client.put("/users/me/theme", headers=self.auth(), json={"theme": "graphite"}).status_code, 204)
        self.assertEqual(self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()["theme"], "graphite")
        self.assertEqual(self.client.put(f"/projects/{project['id']}/theme", headers=self.auth(), json={"theme": "project"}).status_code, 204)
        self.assertEqual(self.client.get(f"/projects/{project['id']}", headers=self.auth()).json()["theme"], "project")
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
