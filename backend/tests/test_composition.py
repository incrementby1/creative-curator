import threading
import time
import unittest
from unittest.mock import Mock, patch

from app.config import RuntimeConfig
from app.llm.types import AiConfigurationRequired
from app.settings.types import RouteTarget


class CompositionTests(unittest.TestCase):
    def setUp(self) -> None:
        from app.composition import clear_application_composition_cache

        clear_application_composition_cache()

    def tearDown(self) -> None:
        from app.composition import clear_application_composition_cache

        clear_application_composition_cache()

    def config(self, transport: str = "test") -> RuntimeConfig:
        return RuntimeConfig(
            app_env="test" if transport == "test" else "development",
            auth_mode="test",
            settings_store_mode="memory",
            llm_transport_mode=transport,
            supabase_url="",
            supabase_anon_key="",
            supabase_service_role_key="",
            master_key=b"k" * 32,
        )

    def test_test_composition_has_no_dispatcher_and_runs_typed_lifecycle(self) -> None:
        from app.composition import build_composition

        with patch("app.composition.LlmDispatcher") as dispatcher_type:
            composition = build_composition(self.config())
        dispatcher_type.assert_not_called()
        self.assertIsNone(composition.dispatcher)

        with self.assertRaises(AiConfigurationRequired):
            composition.hermes.start_session("user-a", "Acme", "A detailed creative brief.")
        composition.settings_service.save_provider(
            "user-a", "openai-api", "test-key", "openai-test-model", None
        )
        composition.settings_service.save_routing(
            "user-a", RouteTarget("openai-api", "openai-test-model"), (), 1
        )
        session = composition.hermes.start_session(
            "user-a", "Acme", "A detailed creative brief."
        )
        composition.hermes.handle_rejection(
            "user-a",
            session["session_id"],
            [
                __import__("app.core.types", fromlist=["Rejection"]).Rejection(2, "too_loud"),
                __import__("app.core.types", fromlist=["Rejection"]).Rejection(3, "not_authentic"),
            ],
        )
        composition.hermes.approve("user-a", session["session_id"])
        result = composition.hermes.execute("user-a", session["session_id"])
        self.assertEqual(result["status"], "executed")
        with self.assertRaises(AiConfigurationRequired):
            composition.hermes.start_session("user-b", "Other", "Another detailed brief.")

    def test_live_composition_owns_one_dispatcher_and_closes_once(self) -> None:
        from app.composition import build_composition

        with patch("app.composition.LlmDispatcher") as dispatcher_type:
            dispatcher = dispatcher_type.return_value
            composition = build_composition(self.config("live"))
            self.assertIs(composition.dispatcher, dispatcher)
            self.assertIs(composition.settings_service._operations._dispatcher, dispatcher)
            self.assertIs(composition.router._dispatcher, dispatcher)
            composition.close()
            composition.close()
        dispatcher.close.assert_called_once_with()

    def test_cached_factory_is_single_flight_on_concurrent_cold_start(self) -> None:
        from app.composition import (
            clear_application_composition_cache,
            get_application_composition,
        )

        workers = 8
        start = threading.Barrier(workers + 1)
        builder_entered = threading.Event()
        release_builder = threading.Event()
        composition = Mock()
        results: list[object] = []
        errors: list[BaseException] = []

        def slow_build(_config: RuntimeConfig) -> object:
            builder_entered.set()
            self.assertTrue(release_builder.wait(timeout=2))
            return composition

        def resolve() -> None:
            try:
                start.wait(timeout=2)
                results.append(get_application_composition())
            except BaseException as exc:  # captured for assertion in test thread
                errors.append(exc)

        with (
            patch("app.composition.RuntimeConfig.from_env", return_value=self.config()) as config_factory,
            patch("app.composition.build_composition", side_effect=slow_build) as builder,
        ):
            threads = [threading.Thread(target=resolve) for _ in range(workers)]
            for thread in threads:
                thread.start()
            start.wait(timeout=2)
            self.assertTrue(builder_entered.wait(timeout=2))
            time.sleep(0.05)
            release_builder.set()
            for thread in threads:
                thread.join(timeout=2)

            self.assertEqual(errors, [])
            self.assertEqual(len(results), workers)
            self.assertTrue(all(result is composition for result in results))
            builder.assert_called_once()
            config_factory.assert_called_once_with()
            clear_application_composition_cache()

        composition.close.assert_called_once_with()

    def test_cached_factory_build_failure_is_retryable(self) -> None:
        from app.composition import (
            clear_application_composition_cache,
            get_application_composition,
        )

        composition = Mock()
        with (
            patch("app.composition.RuntimeConfig.from_env", return_value=self.config()) as config_factory,
            patch(
                "app.composition.build_composition",
                side_effect=(RuntimeError("build failed"), composition),
            ) as builder,
        ):
            with self.assertRaisesRegex(RuntimeError, "build failed"):
                get_application_composition()

            self.assertIs(get_application_composition(), composition)
            self.assertIs(get_application_composition(), composition)
            self.assertEqual(builder.call_count, 2)
            self.assertEqual(config_factory.call_count, 2)
            clear_application_composition_cache()

        composition.close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
