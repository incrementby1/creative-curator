from importlib.util import find_spec
from unittest import TestCase

from fastapi.testclient import TestClient

from app.composition import ApplicationComposition
from app.main import app


class ProductionRuntimeTests(TestCase):
    def test_legacy_creative_routes_are_not_registered(self) -> None:
        client = TestClient(app)
        for method, path in (
            ("post", "/creative/start"),
            ("post", "/creative/reject"),
            ("post", "/creative/approve"),
            ("post", "/creative/execute"),
            ("get", "/creative/sessions"),
            ("get", "/creative/sessions/old-session"),
        ):
            response = client.request(method.upper(), path, json={} if method == "post" else None)
            self.assertEqual(response.status_code, 404)
        self.assertFalse(any(path.startswith("/creative") for path in app.openapi()["paths"]))

    def test_composition_contains_no_session_runtime(self) -> None:
        self.assertNotIn("hermes", ApplicationComposition.__dataclass_fields__)
        self.assertNotIn("session_store", ApplicationComposition.__dataclass_fields__)

    def test_legacy_memory_runtime_is_absent(self) -> None:
        self.assertIsNone(find_spec("app.agents.memory_agent"))
        self.assertIsNone(find_spec("app.memory.brand_store"))
