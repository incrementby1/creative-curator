import sys
import threading
import traceback
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.persistence.settings_store import InMemorySettingsStore, SupabaseSettingsStore
from app.security.credential_cipher import EncryptedCredential
from app.settings.types import (
    ProviderCredentialRecord,
    RouteTarget,
    RoutingSettings,
    SettingsStoreError,
    SettingsVersionConflict,
)


def credential_record(provider_slug: str = "openrouter") -> ProviderCredentialRecord:
    return ProviderCredentialRecord(
        provider_slug=provider_slug,
        encrypted=EncryptedCredential(
            ciphertext="encrypted-value",
            nonce="nonce-value",
            key_version=1,
            masked_suffix="4F2A",
        ),
        base_url="https://example.invalid/api",
        connection_state="connected",
        tested_at=datetime(2026, 7, 22, tzinfo=timezone.utc),
    )


class SettingsTypesTests(unittest.TestCase):
    def test_route_and_record_reject_empty_slugs_and_models(self) -> None:
        for factory in (
            lambda: RouteTarget(provider_slug="", model="model"),
            lambda: RouteTarget(provider_slug="provider", model=""),
            lambda: credential_record(""),
        ):
            with self.subTest(factory=factory):
                with self.assertRaises(ValueError):
                    factory()

    def test_routing_rejects_invalid_versions_duplicates_and_too_many_fallbacks(self) -> None:
        target = RouteTarget("openrouter", "model-a")
        invalid = (
            {"version": 0},
            {"fallbacks": (target, target)},
            {
                "fallbacks": tuple(
                    RouteTarget("openrouter", f"model-{index}") for index in range(6)
                )
            },
            {"primary_provider_slug": "", "primary_model": "model-a"},
            {"primary_provider_slug": "openrouter", "primary_model": ""},
        )
        for overrides in invalid:
            with self.subTest(overrides=overrides):
                with self.assertRaises(ValueError):
                    RoutingSettings(**overrides)

    def test_primary_provider_and_model_are_required_as_a_pair(self) -> None:
        invalid = (
            {"primary_provider_slug": "openrouter"},
            {"primary_model": "model-a"},
            {"primary_provider_slug": "   ", "primary_model": "model-a"},
            {"primary_provider_slug": "openrouter", "primary_model": "   "},
        )

        for values in invalid:
            with self.subTest(values=values):
                with self.assertRaises(ValueError):
                    RoutingSettings(**values)

    def test_fallbacks_are_normalized_without_mutable_source_alias(self) -> None:
        original = RouteTarget("openrouter", "model-a")
        source = [original]

        settings = RoutingSettings(fallbacks=source)  # type: ignore[arg-type]
        source.append(RouteTarget("anthropic", "model-b"))

        self.assertEqual(settings.fallbacks, (original,))
        self.assertIsInstance(settings.fallbacks, tuple)

    def test_list_fallback_limits_and_types_are_validated(self) -> None:
        target = RouteTarget("openrouter", "model-a")
        invalid = (
            [target, target],
            [RouteTarget("openrouter", f"model-{index}") for index in range(6)],
            [target, "not-a-route-target"],
            "not-a-fallback-collection",
            None,
        )

        for fallbacks in invalid:
            with self.subTest(fallbacks=fallbacks):
                with self.assertRaisesRegex(ValueError, "(?i)fallback"):
                    RoutingSettings(fallbacks=fallbacks)  # type: ignore[arg-type]


class InMemorySettingsStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = InMemorySettingsStore()

    def test_credential_upsert_replace_list_get_and_delete(self) -> None:
        original = credential_record()
        replaced = ProviderCredentialRecord(
            provider_slug="openrouter",
            encrypted=EncryptedCredential("new-cipher", "new-nonce", 1, "BEEF"),
            connection_state="needs_attention",
        )

        self.assertEqual(self.store.upsert_credential("user-a", original), original)
        self.assertEqual(self.store.get_credential("user-a", "openrouter"), original)
        self.assertEqual(self.store.list_credentials("user-a"), [original])
        self.assertEqual(self.store.upsert_credential("user-a", replaced), replaced)
        self.assertEqual(self.store.list_credentials("user-a"), [replaced])
        self.assertTrue(self.store.delete_credential("user-a", "openrouter"))
        self.assertFalse(self.store.delete_credential("user-a", "openrouter"))
        self.assertIsNone(self.store.get_credential("user-a", "openrouter"))

    def test_credentials_are_isolated_by_user(self) -> None:
        record = credential_record()
        self.store.upsert_credential("user-a", record)

        self.assertEqual(self.store.list_credentials("user-b"), [])
        self.assertIsNone(self.store.get_credential("user-b", "openrouter"))
        self.assertFalse(self.store.delete_credential("user-b", "openrouter"))
        self.assertEqual(self.store.get_credential("user-a", "openrouter"), record)

    def test_store_has_deepcopy_boundaries(self) -> None:
        record = credential_record()
        stored = self.store.upsert_credential("user-a", record)
        fetched = self.store.get_credential("user-a", "openrouter")

        self.assertIsNot(stored, record)
        self.assertIsNot(fetched, stored)

        routing = RoutingSettings(
            fallbacks=(RouteTarget("openrouter", "model-a"),), version=1
        )
        saved = self.store.save_routing("user-a", routing)
        fetched_routing = self.store.get_routing("user-a")
        self.assertIsNot(saved, fetched_routing)

    def test_routing_default_version_increment_and_stale_update(self) -> None:
        default = self.store.get_routing("user-a")
        self.assertEqual(default, RoutingSettings(version=1))

        saved = self.store.save_routing(
            "user-a",
            RoutingSettings(
                primary_provider_slug="openrouter",
                primary_model="model-a",
                version=1,
            ),
        )
        self.assertEqual(saved.version, 2)
        self.assertEqual(self.store.get_routing("user-a"), saved)

        with self.assertRaises(SettingsVersionConflict):
            self.store.save_routing("user-a", RoutingSettings(version=1))

    def test_routing_is_isolated_by_user(self) -> None:
        self.store.save_routing("user-a", RoutingSettings(version=1))

        self.assertEqual(self.store.get_routing("user-b"), RoutingSettings(version=1))

    def test_same_version_concurrent_saves_are_atomic(self) -> None:
        ready = threading.Barrier(3)
        outcomes: list[str] = []

        def save() -> None:
            ready.wait()
            try:
                self.store.save_routing("user-a", RoutingSettings(version=1))
                outcomes.append("saved")
            except SettingsVersionConflict:
                outcomes.append("conflict")

        self.store._lock.acquire()
        threads = [threading.Thread(target=save) for _ in range(2)]
        try:
            for thread in threads:
                thread.start()
            ready.wait()
        finally:
            self.store._lock.release()
        for thread in threads:
            thread.join(timeout=2)

        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertCountEqual(outcomes, ["saved", "conflict"])
        self.assertEqual(self.store.get_routing("user-a").version, 2)


class FakeQuery:
    def __init__(self, client: "FakeClient", table: str) -> None:
        self.client = client
        self.table = table
        self.operation = ""
        self.filters: list[tuple[str, Any]] = []
        self.payload: dict[str, Any] | None = None
        self.on_conflict: str | None = None

    def select(self, _columns: str) -> "FakeQuery":
        self.operation = "select"
        return self

    def upsert(self, payload: dict, on_conflict: str) -> "FakeQuery":
        self.operation = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def insert(self, payload: dict) -> "FakeQuery":
        self.operation = "insert"
        self.payload = payload
        return self

    def update(self, payload: dict) -> "FakeQuery":
        self.operation = "update"
        self.payload = payload
        return self

    def delete(self) -> "FakeQuery":
        self.operation = "delete"
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self.filters.append((column, value))
        return self

    def limit(self, _count: int) -> "FakeQuery":
        return self

    def execute(self) -> SimpleNamespace:
        self.client.executed.append(self)
        result = self.client.results.pop(0) if self.client.results else []
        if isinstance(result, BaseException):
            raise result
        return SimpleNamespace(data=result)


class FakeClient:
    def __init__(self, results: list[Any] | None = None) -> None:
        self.results = list(results or [])
        self.executed: list[FakeQuery] = []

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)


class StructuredDatabaseError(RuntimeError):
    code = "23505"


class SupabaseSettingsStoreTests(unittest.TestCase):
    def make_store(self, results: list[Any] | None = None) -> tuple[SupabaseSettingsStore, FakeClient]:
        client = FakeClient(results)
        return SupabaseSettingsStore(client), client

    def assert_sanitized_traceback(
        self,
        operation: Any,
        expected_exception: type[SettingsStoreError] = SettingsStoreError,
    ) -> None:
        sentinel = "LEAK_SENTINEL plaintext-key ciphertext-row"
        try:
            operation(sentinel)
        except expected_exception as exc:
            formatted = "".join(
                traceback.format_exception(type(exc), exc, exc.__traceback__)
            )
            self.assertNotIn(sentinel, formatted)
            self.assertIsNone(exc.__cause__)
            self.assertTrue(exc.__suppress_context__)
        else:
            self.fail(f"{expected_exception.__name__} was not raised")

    def test_credential_operations_are_owner_scoped_and_store_no_plaintext(self) -> None:
        row = {
            "provider_slug": "openrouter",
            "ciphertext": "encrypted-value",
            "nonce": "nonce-value",
            "key_version": 1,
            "masked_suffix": "4F2A",
            "base_url": None,
            "connection_state": "connected",
            "tested_at": None,
        }
        store, client = self.make_store([[row], [row], [row], [row]])

        store.list_credentials("user-a")
        store.get_credential("user-a", "openrouter")
        store.upsert_credential("user-a", credential_record())
        self.assertTrue(store.delete_credential("user-a", "openrouter"))

        list_query, get_query, upsert_query, delete_query = client.executed
        self.assertIn(("user_id", "user-a"), list_query.filters)
        self.assertIn(("user_id", "user-a"), get_query.filters)
        self.assertIn(("provider_slug", "openrouter"), get_query.filters)
        self.assertEqual(upsert_query.payload["user_id"], "user-a")
        self.assertEqual(upsert_query.on_conflict, "user_id,provider_slug")
        self.assert_utc_updated_at_without_created_at(upsert_query.payload)
        self.assertNotIn("secret", upsert_query.payload)
        self.assertNotIn("plaintext", upsert_query.payload)
        self.assertIn(("user_id", "user-a"), delete_query.filters)
        self.assertIn(("provider_slug", "openrouter"), delete_query.filters)

    def test_upsert_forces_method_user_id(self) -> None:
        store, client = self.make_store([[{
            "provider_slug": "openrouter",
            "ciphertext": "encrypted-value",
            "nonce": "nonce-value",
            "key_version": 1,
            "masked_suffix": "4F2A",
            "base_url": None,
            "connection_state": "connected",
            "tested_at": None,
        }]])

        store.upsert_credential("owner", credential_record())

        self.assertEqual(client.executed[0].payload["user_id"], "owner")

    def test_routing_read_and_existing_cas_filter_owner_and_version(self) -> None:
        existing = {
            "user_id": "user-a",
            "primary_provider_slug": None,
            "primary_model": None,
            "fallbacks": [],
            "version": 3,
        }
        updated = {**existing, "version": 4}
        store, client = self.make_store([[existing], [existing], [updated]])

        self.assertEqual(store.get_routing("user-a").version, 3)
        saved = store.save_routing("user-a", RoutingSettings(version=3))

        self.assertEqual(saved.version, 4)
        read_query, cas_read_query, update_query = client.executed
        self.assertIn(("user_id", "user-a"), read_query.filters)
        self.assertIn(("user_id", "user-a"), cas_read_query.filters)
        self.assertIn(("user_id", "user-a"), update_query.filters)
        self.assertIn(("version", 3), update_query.filters)
        self.assert_utc_updated_at_without_created_at(update_query.payload)

    def test_first_routing_save_inserts_version_two(self) -> None:
        inserted = {
            "user_id": "user-a",
            "primary_provider_slug": "openrouter",
            "primary_model": "model-a",
            "fallbacks": [],
            "version": 2,
        }
        store, client = self.make_store([[], [inserted]])

        saved = store.save_routing(
            "user-a",
            RoutingSettings("openrouter", "model-a", version=1),
        )

        self.assertEqual(saved.version, 2)
        self.assertEqual(client.executed[1].payload["user_id"], "user-a")
        self.assertEqual(client.executed[1].payload["version"], 2)
        self.assert_utc_updated_at_without_created_at(client.executed[1].payload)

    def test_routing_update_rejects_stale_version(self) -> None:
        existing = {
            "user_id": "user-a",
            "primary_provider_slug": None,
            "primary_model": None,
            "fallbacks": [],
            "version": 2,
        }
        store, _client = self.make_store([[existing]])

        with self.assertRaises(SettingsVersionConflict):
            store.save_routing("user-a", RoutingSettings(version=1))

    def test_zero_row_cas_update_is_a_conflict(self) -> None:
        existing = {
            "user_id": "user-a",
            "primary_provider_slug": None,
            "primary_model": None,
            "fallbacks": [],
            "version": 2,
        }
        store, _client = self.make_store([[existing], []])

        with self.assertRaises(SettingsVersionConflict):
            store.save_routing("user-a", RoutingSettings(version=2))

    def test_malformed_cas_response_is_a_generic_store_error(self) -> None:
        existing = {
            "user_id": "user-a",
            "primary_provider_slug": None,
            "primary_model": None,
            "fallbacks": [],
            "version": 2,
        }
        store, _client = self.make_store([[existing], [{"private": "row-secret"}]])

        with self.assertRaisesRegex(SettingsStoreError, "Settings store operation failed") as raised:
            store.save_routing("user-a", RoutingSettings(version=2))
        self.assertNotIn("row-secret", str(raised.exception))

    def test_first_insert_race_is_a_conflict(self) -> None:
        store, _client = self.make_store(
            [[], StructuredDatabaseError("database constraint failure")]
        )

        with self.assertRaises(SettingsVersionConflict):
            store.save_routing("user-a", RoutingSettings(version=1))

    def test_first_insert_non_conflict_failure_is_generic(self) -> None:
        store, _client = self.make_store([[], RuntimeError("connection unavailable")])

        with self.assertRaisesRegex(SettingsStoreError, "Settings store operation failed"):
            store.save_routing("user-a", RoutingSettings(version=1))

    def test_duplicate_word_without_structured_unique_code_is_generic(self) -> None:
        store, _client = self.make_store(
            [[], RuntimeError("duplicate transport response unrelated to uniqueness")]
        )

        with self.assertRaises(SettingsStoreError) as raised:
            store.save_routing("user-a", RoutingSettings(version=1))
        self.assertNotIsInstance(raised.exception, SettingsVersionConflict)

    def test_store_failures_are_generic(self) -> None:
        store, _client = self.make_store([RuntimeError("secret row content")])

        with self.assertRaisesRegex(SettingsStoreError, "Settings store operation failed") as raised:
            store.list_credentials("user-a")
        self.assertNotIn("secret row content", str(raised.exception))

    def test_crud_and_read_failures_do_not_leak_sdk_exception_in_traceback(self) -> None:
        operations = (
            lambda sentinel: self.make_store([RuntimeError(sentinel)])[
                0
            ].list_credentials("user-a"),
            lambda sentinel: self.make_store([RuntimeError(sentinel)])[
                0
            ].get_credential("user-a", "openrouter"),
            lambda sentinel: self.make_store([RuntimeError(sentinel)])[
                0
            ].upsert_credential("user-a", credential_record()),
            lambda sentinel: self.make_store([RuntimeError(sentinel)])[
                0
            ].delete_credential("user-a", "openrouter"),
            lambda sentinel: self.make_store([RuntimeError(sentinel)])[0].get_routing(
                "user-a"
            ),
        )

        for operation in operations:
            with self.subTest(operation=operation):
                self.assert_sanitized_traceback(operation)

    def test_cas_update_failure_does_not_leak_sdk_exception_in_traceback(self) -> None:
        existing = {
            "user_id": "user-a",
            "primary_provider_slug": None,
            "primary_model": None,
            "fallbacks": [],
            "version": 2,
        }

        def operation(sentinel: str) -> None:
            store, _client = self.make_store([[existing], RuntimeError(sentinel)])
            store.save_routing("user-a", RoutingSettings(version=2))

        self.assert_sanitized_traceback(operation)

    def test_unique_insert_conflict_does_not_leak_sdk_exception_in_traceback(self) -> None:
        def operation(sentinel: str) -> None:
            store, _client = self.make_store(
                [[], StructuredDatabaseError(sentinel)]
            )
            store.save_routing("user-a", RoutingSettings(version=1))

        self.assert_sanitized_traceback(operation, SettingsVersionConflict)

    def test_cas_rejects_complete_but_mismatched_response_rows(self) -> None:
        existing = {
            "user_id": "user-a",
            "primary_provider_slug": "openrouter",
            "primary_model": "model-a",
            "fallbacks": [{"provider_slug": "anthropic", "model": "model-b"}],
            "version": 3,
        }
        requested = RoutingSettings(
            primary_provider_slug="openrouter",
            primary_model="model-a",
            fallbacks=(RouteTarget("anthropic", "model-b"),),
            version=3,
        )
        valid_response = {**existing, "version": 4}
        mismatches = (
            {**valid_response, "user_id": "user-b"},
            {**valid_response, "version": 5},
            {**valid_response, "primary_model": "different-model"},
            {
                **valid_response,
                "fallbacks": [{"provider_slug": "other", "model": "model-c"}],
            },
        )

        for response in mismatches:
            with self.subTest(response=response):
                store, _client = self.make_store([[existing], [response]])
                with self.assertRaises(SettingsVersionConflict):
                    store.save_routing("user-a", requested)

    def assert_utc_updated_at_without_created_at(self, payload: dict) -> None:
        self.assertNotIn("created_at", payload)
        updated_at = datetime.fromisoformat(payload["updated_at"])
        self.assertEqual(updated_at.utcoffset(), timedelta(0))


if __name__ == "__main__":
    unittest.main()
