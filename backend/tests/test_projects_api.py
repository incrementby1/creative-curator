from __future__ import annotations

import unittest

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
        from app.projects.service import ProjectService
        from app.projects.store import InMemoryProjectStore

        self.previous_verifier = app.dependency_overrides.get(get_identity_verifier)
        self.store = InMemoryProjectStore()
        self.service = ProjectService(self.store)
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
        self.client = TestClient(app)

    def tearDown(self) -> None:
        dependencies = [(get_identity_verifier, self.previous_verifier)]
        if self.get_project_service is not None:
            dependencies.append((self.get_project_service, self.previous_service))
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
            json={"expected_annotation_version": 1, "discard_media_on_failure": [uploaded["id"]],
                  "annotations": [{"annotation_type": "media", "media_id": uploaded["id"]}]},
        )
        self.assertEqual(failed.status_code, 409)
        self.assertEqual(self.client.get(
            f"/projects/{project['id']}/media/{uploaded['id']}", headers=self.auth()
        ).status_code, 404)

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


if __name__ == "__main__":
    unittest.main()
