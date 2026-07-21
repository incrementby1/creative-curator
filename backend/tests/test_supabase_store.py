import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.persistence.session_store import SupabaseSessionStore, require_local_supabase_url


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
        if not self.url or not self.key:
            self.skipTest("SUPABASE_LOCAL_TEST_URL and SUPABASE_LOCAL_TEST_KEY are required")

        require_local_supabase_url(self.url)

        self.store = SupabaseSessionStore(url=self.url, key=self.key)
        self.session_id = str(uuid4())

    def tearDown(self) -> None:
        if hasattr(self, "store"):
            self.store._client.table("creative_sessions").delete().eq(
                "id", self.session_id
            ).execute()

    def test_create_get_and_save_state(self) -> None:
        initial_state = {
            "brand_name": "Local Test Brand",
            "description": "A session used only by the local Supabase integration test.",
            "goal": "Verify local persistence",
            "status": "active",
        }
        updated_state = {**initial_state, "status": "approved", "revision": 2}

        self.store.create(self.session_id, initial_state)
        self.assertEqual(self.store.get(self.session_id), initial_state)

        self.store.save(self.session_id, updated_state)
        self.assertEqual(self.store.get(self.session_id), updated_state)


if __name__ == "__main__":
    unittest.main()
