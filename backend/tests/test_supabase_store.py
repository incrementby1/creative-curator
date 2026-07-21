import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.persistence.session_store import SupabaseSessionStore, require_local_supabase_url


class FakeQuery:
    def __init__(self) -> None:
        self.filters: list[tuple[str, str]] = []
        self.payload: dict | None = None
        self.data: list[dict] = []

    def insert(self, payload: dict) -> "FakeQuery":
        self.payload = payload
        return self

    def select(self, _columns: str) -> "FakeQuery":
        return self

    def update(self, payload: dict) -> "FakeQuery":
        self.payload = payload
        return self

    def eq(self, column: str, value: str) -> "FakeQuery":
        self.filters.append((column, value))
        return self

    def limit(self, _count: int) -> "FakeQuery":
        return self

    def execute(self) -> "FakeQuery":
        return self


class FakeClient:
    def __init__(self) -> None:
        self.query = FakeQuery()

    def table(self, _name: str) -> FakeQuery:
        return self.query


class SupabaseSessionStoreScopeTests(unittest.TestCase):
    def make_store(self) -> tuple[SupabaseSessionStore, FakeQuery]:
        store = SupabaseSessionStore.__new__(SupabaseSessionStore)
        client = FakeClient()
        store._client = client
        store._table = "creative_sessions"
        return store, client.query

    def test_create_includes_user_id(self) -> None:
        store, query = self.make_store()

        store.create("user-a", "session-1", {"brand_name": "Acme"})

        self.assertEqual(query.payload["user_id"], "user-a")

    def test_get_filters_by_user_id_and_session_id(self) -> None:
        store, query = self.make_store()

        store.get("user-a", "session-1")

        self.assertEqual(
            query.filters, [("id", "session-1"), ("user_id", "user-a")]
        )

    def test_save_filters_by_user_id_and_session_id(self) -> None:
        store, query = self.make_store()

        store.save("user-a", "session-1", {"status": "approved"})

        self.assertEqual(
            query.filters, [("id", "session-1"), ("user_id", "user-a")]
        )


class LocalSupabaseUrlGuardTests(unittest.TestCase):
    def test_rejects_remote_host(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "localhost or 127.0.0.1"):
            require_local_supabase_url("https://project.supabase.co")

    def test_accepts_loopback_hosts(self) -> None:
        require_local_supabase_url("http://127.0.0.1:54321")
        require_local_supabase_url("http://localhost:54321")


class LocalSupabaseSessionStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.url = os.getenv("SUPABASE_LOCAL_TEST_URL")
        self.key = os.getenv("SUPABASE_LOCAL_TEST_KEY")
        self.user_id = os.getenv("SUPABASE_LOCAL_TEST_USER_ID")
        if not self.url or not self.key or not self.user_id:
            self.skipTest(
                "SUPABASE_LOCAL_TEST_URL, SUPABASE_LOCAL_TEST_KEY, and "
                "SUPABASE_LOCAL_TEST_USER_ID are required"
            )

        require_local_supabase_url(self.url)

        self.store = SupabaseSessionStore(url=self.url, key=self.key)
        self.session_id = str(uuid4())

    def tearDown(self) -> None:
        if hasattr(self, "store"):
            self.store._client.table("creative_sessions").delete().eq(
                "id", self.session_id
            ).eq("user_id", self.user_id).execute()

    def test_create_get_and_save_state(self) -> None:
        initial_state = {
            "brand_name": "Local Test Brand",
            "description": "A session used only by the local Supabase integration test.",
            "goal": "Verify local persistence",
            "status": "active",
        }
        updated_state = {**initial_state, "status": "approved", "revision": 2}

        self.store.create(self.user_id, self.session_id, initial_state)
        self.assertEqual(self.store.get(self.user_id, self.session_id), initial_state)

        self.store.save(self.user_id, self.session_id, updated_state)
        self.assertEqual(self.store.get(self.user_id, self.session_id), updated_state)


if __name__ == "__main__":
    unittest.main()
