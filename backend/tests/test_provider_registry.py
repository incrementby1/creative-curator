import copy
import json
import re
import unittest

from app.settings.provider_registry import (
    EndpointSuffixRoute,
    KeyPrefixRoute,
    ModelDiscovery,
    ModelTransportRoute,
    ProviderMetadata,
    ProviderManifestError,
    ProviderNotFound,
    ProviderRegistry,
    ProviderRules,
)


EXPECTED = {
    "openrouter", "custom", "openai-api", "copilot", "gemini", "zai",
    "kimi-coding", "kimi-coding-cn", "stepfun", "arcee", "gmi", "minimax",
    "anthropic", "alibaba", "alibaba-coding-plan", "minimax-cn", "deepseek",
    "xai", "nvidia", "opencode-zen", "opencode-go", "kilocode", "huggingface",
    "xiaomi", "tencent-tokenhub", "ollama-cloud", "azure-foundry", "novita",
}

PINNED_AUTHORITATIVE_SOURCE_PATHS = {
    "hermes_cli/auth.py",
    "hermes_cli/models.py",
    "hermes_cli/providers.py",
    "hermes_cli/runtime_provider.py",
}


class ProviderRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = ProviderRegistry.load_default()
        manifest_path = (
            __import__("pathlib").Path(__file__).parents[1]
            / "app"
            / "settings"
            / "provider_manifest.json"
        )
        cls.manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    def test_default_manifest_has_pinned_official_source(self):
        self.assertIs(type(self.registry.manifest_version), int)
        self.assertGreater(self.registry.manifest_version, 0)
        self.assertEqual(
            self.registry.source_repository,
            "https://github.com/NousResearch/hermes-agent",
        )
        self.assertRegex(self.registry.source_commit, r"^[0-9a-f]{40}$")
        self.assertEqual(self.registry.source_commit, "8208fc52701332f213e6c51ebc0b610be00300de")
        self.assertTrue(self.registry.source_paths)
        self.assertTrue(all(isinstance(path, str) and path for path in self.registry.source_paths))
        self.assertTrue(PINNED_AUTHORITATIVE_SOURCE_PATHS.issubset(self.registry.source_paths))

    def test_registry_and_exposed_collections_are_immutable(self):
        replacements = {
            "manifest_version": 99,
            "source_repository": "https://example.com/repository",
            "source_commit": "0" * 40,
            "source_paths": (),
            "providers": (),
            "_by_slug": {},
        }
        for name, value in replacements.items():
            with self.subTest(field=name), self.assertRaises((AttributeError, TypeError)):
                setattr(ProviderRegistry.load_default(), name, value)
        registry = ProviderRegistry.load_default()
        with self.assertRaises(TypeError):
            registry._by_slug["replacement"] = registry.providers[0]
        with self.assertRaises((AttributeError, TypeError)):
            registry.providers[0].rules.custom_endpoint_required = True
        with self.assertRaises(TypeError):
            registry.source_paths[0] = "replacement"
        with self.assertRaises(TypeError):
            registry.providers[0] = registry.providers[-1]

    def test_direct_constructors_validate_and_break_mutable_aliases(self):
        with self.assertRaises(ProviderManifestError):
            ModelDiscovery(strategy="unknown", supported=True)
        with self.assertRaises(ProviderManifestError):
            ModelDiscovery(strategy="none", supported=True)

        source_keys = ["DIRECT_API_KEY"]
        source_envs = ["DIRECT_BASE_URL"]
        source_rules = {}
        provider = ProviderMetadata(
            slug="direct",
            display_name="Direct",
            key_names=source_keys,
            default_base_url="https://api.example.com/v1",
            base_url_env_names=source_envs,
            requires_custom_base_url=False,
            transport="chat",
            model_discovery=ModelDiscovery("openai_models", True),
            manual_model_entry=True,
            rules=source_rules,
        )
        source_keys.append("MUTATED_KEY")
        source_envs.append("MUTATED_URL")
        source_rules["custom_endpoint_required"] = True
        self.assertEqual(provider.key_names, ("DIRECT_API_KEY",))
        self.assertEqual(provider.base_url_env_names, ("DIRECT_BASE_URL",))
        self.assertEqual(provider.rules, ProviderRules())

        source_paths = ["hermes_cli/auth.py"]
        source_providers = [provider]
        registry = ProviderRegistry(
            manifest_version=1,
            source_repository="https://github.com/NousResearch/hermes-agent",
            source_commit="0" * 40,
            source_paths=source_paths,
            providers=source_providers,
        )
        source_paths.append("mutated.py")
        source_providers.clear()
        self.assertEqual(registry.source_paths, ("hermes_cli/auth.py",))
        self.assertEqual(registry.providers, (provider,))
        self.assertEqual(registry.get("direct"), provider)

    def test_direct_constructors_reject_invalid_metadata(self):
        provider = self.registry.providers[0]
        invalid_registries = (
            {"manifest_version": True},
            {"source_repository": "https://example.com/repository"},
            {"source_commit": "main"},
            {"source_paths": []},
            {"providers": [provider, provider]},
            {"providers": [{}]},
        )
        baseline = {
            "manifest_version": 1,
            "source_repository": "https://github.com/NousResearch/hermes-agent",
            "source_commit": "0" * 40,
            "source_paths": ["hermes_cli/auth.py"],
            "providers": [provider],
        }
        for override in invalid_registries:
            with self.subTest(override=override), self.assertRaises(ProviderManifestError):
                ProviderRegistry(**(baseline | override))

        for field, value in (
            ("slug", "Bad Slug"),
            ("key_names", []),
            ("default_base_url", "http://example.com/v1"),
            ("transport", "grpc"),
            ("manual_model_entry", 1),
            ("rules", []),
        ):
            values = {
                "slug": "direct",
                "display_name": "Direct",
                "key_names": ["DIRECT_API_KEY"],
                "default_base_url": "https://api.example.com/v1",
                "base_url_env_names": [],
                "requires_custom_base_url": False,
                "transport": "chat",
                "model_discovery": ModelDiscovery("openai_models", True),
                "manual_model_entry": True,
                "rules": {},
            }
            values[field] = value
            with self.subTest(field=field), self.assertRaises(ProviderManifestError):
                ProviderMetadata(**values)

    def test_default_manifest_has_exact_approved_api_key_provider_set(self):
        self.assertEqual(set(self.registry.slugs()), EXPECTED)
        self.assertEqual(len(self.registry.slugs()), len(EXPECTED))

    def test_provider_metadata_is_complete_and_immutable(self):
        allowed_transports = {"chat", "responses", "anthropic", "gemini", "copilot", "auto"}
        allowed_discovery = {
            "openai_models", "anthropic_models", "gemini_models", "copilot_models", "none"
        }
        for slug in self.registry.slugs():
            provider = self.registry.get(slug)
            self.assertEqual(provider.slug, slug)
            self.assertTrue(provider.display_name.strip())
            self.assertTrue(provider.key_names)
            self.assertEqual(len(provider.key_names), len(set(provider.key_names)))
            self.assertTrue(all(re.fullmatch(r"[A-Z][A-Z0-9_]*", name) for name in provider.key_names))
            self.assertIn(provider.transport, allowed_transports)
            self.assertIn(provider.model_discovery.strategy, allowed_discovery)
            self.assertIs(type(provider.model_discovery.supported), bool)
            self.assertIs(type(provider.manual_model_entry), bool)
            self.assertIs(type(provider.requires_custom_base_url), bool)
            self.assertIsInstance(provider.base_url_env_names, tuple)
            self.assertEqual(len(provider.base_url_env_names), len(set(provider.base_url_env_names)))
            self.assertIsInstance(provider.rules, ProviderRules)
            with self.assertRaises((AttributeError, TypeError)):
                provider.rules.custom_endpoint_required = True

    def test_expected_priority_aliases_endpoints_and_transports(self):
        expected = {
            "openrouter": (("OPENROUTER_API_KEY",), "https://openrouter.ai/api/v1", "chat"),
            "custom": (("OPENAI_API_KEY",), None, "auto"),
            "openai-api": (("OPENAI_API_KEY",), "https://api.openai.com/v1", "responses"),
            "copilot": (("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"), "https://api.githubcopilot.com", "copilot"),
            "gemini": (("GOOGLE_API_KEY", "GEMINI_API_KEY"), "https://generativelanguage.googleapis.com/v1beta", "gemini"),
            "zai": (("GLM_API_KEY", "ZAI_API_KEY", "Z_AI_API_KEY"), "https://api.z.ai/api/paas/v4", "chat"),
            "kimi-coding": (("KIMI_API_KEY", "KIMI_CODING_API_KEY"), "https://api.moonshot.ai/v1", "auto"),
            "kimi-coding-cn": (("KIMI_CN_API_KEY",), "https://api.moonshot.cn/v1", "chat"),
            "stepfun": (("STEPFUN_API_KEY",), "https://api.stepfun.ai/step_plan/v1", "chat"),
            "arcee": (("ARCEEAI_API_KEY",), "https://api.arcee.ai/api/v1", "chat"),
            "gmi": (("GMI_API_KEY",), "https://api.gmi-serving.com/v1", "chat"),
            "minimax": (("MINIMAX_API_KEY",), "https://api.minimax.io/anthropic", "anthropic"),
            "anthropic": (("ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"), "https://api.anthropic.com", "anthropic"),
            "alibaba": (("DASHSCOPE_API_KEY",), "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "chat"),
            "alibaba-coding-plan": (("ALIBABA_CODING_PLAN_API_KEY", "DASHSCOPE_API_KEY"), "https://coding-intl.dashscope.aliyuncs.com/v1", "chat"),
            "minimax-cn": (("MINIMAX_CN_API_KEY",), "https://api.minimaxi.com/anthropic", "anthropic"),
            "deepseek": (("DEEPSEEK_API_KEY",), "https://api.deepseek.com/v1", "chat"),
            "xai": (("XAI_API_KEY",), "https://api.x.ai/v1", "responses"),
            "nvidia": (("NVIDIA_API_KEY",), "https://integrate.api.nvidia.com/v1", "chat"),
            "opencode-zen": (("OPENCODE_ZEN_API_KEY",), "https://opencode.ai/zen/v1", "chat"),
            "opencode-go": (("OPENCODE_GO_API_KEY",), "https://opencode.ai/zen/go/v1", "auto"),
            "kilocode": (("KILOCODE_API_KEY",), "https://api.kilo.ai/api/gateway", "chat"),
            "huggingface": (("HF_TOKEN",), "https://router.huggingface.co/v1", "chat"),
            "xiaomi": (("XIAOMI_API_KEY",), "https://api.xiaomimimo.com/v1", "chat"),
            "tencent-tokenhub": (("TOKENHUB_API_KEY",), "https://tokenhub.tencentmaas.com/v1", "chat"),
            "ollama-cloud": (("OLLAMA_API_KEY",), "https://ollama.com/v1", "chat"),
            "azure-foundry": (("AZURE_FOUNDRY_API_KEY",), None, "auto"),
            "novita": (("NOVITA_API_KEY",), "https://api.novita.ai/openai/v1", "chat"),
        }
        for slug, (keys, base_url, transport) in expected.items():
            provider = self.registry.get(slug)
            self.assertEqual(provider.key_names, keys, slug)
            self.assertEqual(provider.default_base_url, base_url, slug)
            self.assertEqual(provider.transport, transport, slug)

    def test_every_provider_matches_reviewed_routing_snapshot(self):
        expected = {
            "openrouter": (("OPENROUTER_API_KEY",), ("OPENROUTER_BASE_URL",), "https://openrouter.ai/api/v1", "chat", "openai_models", True, ProviderRules()),
            "custom": (("OPENAI_API_KEY",), ("CUSTOM_BASE_URL",), None, "auto", "openai_models", True, ProviderRules(custom_endpoint_required=True, supports_explicit_transport=True)),
            "openai-api": (("OPENAI_API_KEY",), ("OPENAI_BASE_URL",), "https://api.openai.com/v1", "responses", "openai_models", True, ProviderRules()),
            "copilot": (("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"), ("COPILOT_API_BASE_URL",), "https://api.githubcopilot.com", "copilot", "copilot_models", True, ProviderRules()),
            "gemini": (("GOOGLE_API_KEY", "GEMINI_API_KEY"), ("GEMINI_BASE_URL",), "https://generativelanguage.googleapis.com/v1beta", "gemini", "gemini_models", True, ProviderRules()),
            "zai": (("GLM_API_KEY", "ZAI_API_KEY", "Z_AI_API_KEY"), ("GLM_BASE_URL",), "https://api.z.ai/api/paas/v4", "chat", "openai_models", True, ProviderRules()),
            "kimi-coding": (("KIMI_API_KEY", "KIMI_CODING_API_KEY"), ("KIMI_BASE_URL",), "https://api.moonshot.ai/v1", "auto", "openai_models", True, ProviderRules(key_prefix_routes=(KeyPrefixRoute("sk-kimi-", "https://api.kimi.com/coding", "anthropic"),), supports_explicit_transport=True)),
            "kimi-coding-cn": (("KIMI_CN_API_KEY",), (), "https://api.moonshot.cn/v1", "chat", "openai_models", True, ProviderRules()),
            "stepfun": (("STEPFUN_API_KEY",), ("STEPFUN_BASE_URL",), "https://api.stepfun.ai/step_plan/v1", "chat", "openai_models", True, ProviderRules()),
            "arcee": (("ARCEEAI_API_KEY",), ("ARCEE_BASE_URL",), "https://api.arcee.ai/api/v1", "chat", "openai_models", True, ProviderRules()),
            "gmi": (("GMI_API_KEY",), ("GMI_BASE_URL",), "https://api.gmi-serving.com/v1", "chat", "openai_models", True, ProviderRules()),
            "minimax": (("MINIMAX_API_KEY",), ("MINIMAX_BASE_URL",), "https://api.minimax.io/anthropic", "anthropic", "openai_models", True, ProviderRules()),
            "anthropic": (("ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"), ("ANTHROPIC_BASE_URL",), "https://api.anthropic.com", "anthropic", "anthropic_models", True, ProviderRules()),
            "alibaba": (("DASHSCOPE_API_KEY",), ("DASHSCOPE_BASE_URL",), "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "chat", "openai_models", True, ProviderRules()),
            "alibaba-coding-plan": (("ALIBABA_CODING_PLAN_API_KEY", "DASHSCOPE_API_KEY"), ("ALIBABA_CODING_PLAN_BASE_URL",), "https://coding-intl.dashscope.aliyuncs.com/v1", "chat", "openai_models", True, ProviderRules()),
            "minimax-cn": (("MINIMAX_CN_API_KEY",), ("MINIMAX_CN_BASE_URL",), "https://api.minimaxi.com/anthropic", "anthropic", "none", False, ProviderRules()),
            "deepseek": (("DEEPSEEK_API_KEY",), ("DEEPSEEK_BASE_URL",), "https://api.deepseek.com/v1", "chat", "openai_models", True, ProviderRules()),
            "xai": (("XAI_API_KEY",), ("XAI_BASE_URL",), "https://api.x.ai/v1", "responses", "openai_models", True, ProviderRules()),
            "nvidia": (("NVIDIA_API_KEY",), ("NVIDIA_BASE_URL",), "https://integrate.api.nvidia.com/v1", "chat", "openai_models", True, ProviderRules()),
            "opencode-zen": (("OPENCODE_ZEN_API_KEY",), ("OPENCODE_ZEN_BASE_URL",), "https://opencode.ai/zen/v1", "chat", "openai_models", True, ProviderRules(model_transport_routes=(ModelTransportRoute(("claude-", "qwen"), "anthropic"), ModelTransportRoute(("gpt-",), "responses")), normalize_anthropic_v1_suffix=True)),
            "opencode-go": (("OPENCODE_GO_API_KEY",), ("OPENCODE_GO_BASE_URL",), "https://opencode.ai/zen/go/v1", "auto", "none", False, ProviderRules(model_transport_routes=(ModelTransportRoute(("minimax-", "qwen"), "anthropic"),), normalize_anthropic_v1_suffix=True)),
            "kilocode": (("KILOCODE_API_KEY",), ("KILOCODE_BASE_URL",), "https://api.kilo.ai/api/gateway", "chat", "openai_models", True, ProviderRules()),
            "huggingface": (("HF_TOKEN",), ("HF_BASE_URL",), "https://router.huggingface.co/v1", "chat", "openai_models", True, ProviderRules()),
            "xiaomi": (("XIAOMI_API_KEY",), ("XIAOMI_BASE_URL",), "https://api.xiaomimimo.com/v1", "chat", "openai_models", True, ProviderRules()),
            "tencent-tokenhub": (("TOKENHUB_API_KEY",), ("TOKENHUB_BASE_URL",), "https://tokenhub.tencentmaas.com/v1", "chat", "openai_models", True, ProviderRules()),
            "ollama-cloud": (("OLLAMA_API_KEY",), ("OLLAMA_BASE_URL",), "https://ollama.com/v1", "chat", "openai_models", True, ProviderRules()),
            "azure-foundry": (("AZURE_FOUNDRY_API_KEY",), ("AZURE_FOUNDRY_BASE_URL",), None, "auto", "openai_models", True, ProviderRules(custom_endpoint_required=True, model_transport_routes=(ModelTransportRoute(("gpt-5", "codex", "o1", "o3", "o4"), "responses"),), endpoint_suffix_routes=(EndpointSuffixRoute(("/anthropic", "/anthropic/v1"), "anthropic"),), supports_explicit_transport=True, normalize_anthropic_v1_suffix=True)),
            "novita": (("NOVITA_API_KEY",), ("NOVITA_BASE_URL",), "https://api.novita.ai/openai/v1", "chat", "openai_models", True, ProviderRules()),
        }
        self.assertEqual(set(expected), EXPECTED)
        for slug, (keys, envs, url, transport, strategy, supported, rules) in expected.items():
            provider = self.registry.get(slug)
            self.assertEqual(provider.key_names, keys, slug)
            self.assertEqual(provider.base_url_env_names, envs, slug)
            self.assertEqual(provider.default_base_url, url, slug)
            self.assertEqual(provider.transport, transport, slug)
            self.assertEqual(provider.model_discovery.strategy, strategy, slug)
            self.assertEqual(provider.model_discovery.supported, supported, slug)
            self.assertTrue(provider.manual_model_entry, slug)
            self.assertEqual(provider.rules, rules, slug)

    def test_unknown_provider_raises_typed_key_error(self):
        with self.assertRaisesRegex(ProviderNotFound, "unknown-provider"):
            self.registry.get("unknown-provider")

    def test_rules_capture_required_provider_dispatch(self):
        self.assertTrue(self.registry.get("custom").rules.custom_endpoint_required)
        self.assertEqual(
            self.registry.get("kimi-coding").rules.key_prefix_routes[0].prefix,
            "sk-kimi-",
        )
        self.assertTrue(self.registry.get("opencode-go").rules.model_transport_routes)
        self.assertTrue(self.registry.get("azure-foundry").rules.supports_explicit_transport)

    def test_provider_rules_are_typed_complete_and_immutable(self):
        self.assertEqual(
            self.registry.get("kimi-coding").rules,
            ProviderRules(
                key_prefix_routes=(
                    KeyPrefixRoute("sk-kimi-", "https://api.kimi.com/coding", "anthropic"),
                ),
                supports_explicit_transport=True,
            ),
        )
        self.assertEqual(
            self.registry.get("opencode-zen").rules,
            ProviderRules(
                model_transport_routes=(
                    ModelTransportRoute(("claude-", "qwen"), "anthropic"),
                    ModelTransportRoute(("gpt-",), "responses"),
                ),
                normalize_anthropic_v1_suffix=True,
            ),
        )
        self.assertEqual(
            self.registry.get("opencode-go").rules,
            ProviderRules(
                model_transport_routes=(
                    ModelTransportRoute(("minimax-", "qwen"), "anthropic"),
                ),
                normalize_anthropic_v1_suffix=True,
            ),
        )
        self.assertEqual(
            self.registry.get("azure-foundry").rules,
            ProviderRules(
                custom_endpoint_required=True,
                model_transport_routes=(
                    ModelTransportRoute(("gpt-5", "codex", "o1", "o3", "o4"), "responses"),
                ),
                endpoint_suffix_routes=(
                    EndpointSuffixRoute(("/anthropic", "/anthropic/v1"), "anthropic"),
                ),
                supports_explicit_transport=True,
                normalize_anthropic_v1_suffix=True,
            ),
        )
        self.assertEqual(
            self.registry.get("custom").rules,
            ProviderRules(custom_endpoint_required=True, supports_explicit_transport=True),
        )

    def test_typed_rules_break_aliases_and_reject_duplicate_selectors(self):
        prefixes = ["alpha-"]
        route = ModelTransportRoute(prefixes, "chat")
        prefixes.append("mutated-")
        routes = [route]
        rules = ProviderRules(model_transport_routes=routes)
        routes.clear()
        self.assertEqual(route.prefixes, ("alpha-",))
        self.assertEqual(rules.model_transport_routes, (route,))

        with self.assertRaises(ProviderManifestError):
            ProviderRules(
                key_prefix_routes=(
                    KeyPrefixRoute("same-", "https://one.example/v1", "chat"),
                    KeyPrefixRoute("same-", "https://two.example/v1", "anthropic"),
                )
            )
        with self.assertRaises(ProviderManifestError):
            ProviderRules(
                model_transport_routes=(
                    ModelTransportRoute(("same-",), "chat"),
                    ModelTransportRoute(("same-",), "anthropic"),
                )
            )
        with self.assertRaises(ProviderManifestError):
            ProviderRules(
                endpoint_suffix_routes=(
                    EndpointSuffixRoute(("/same",), "chat"),
                    EndpointSuffixRoute(("/same",), "anthropic"),
                )
            )

    def test_custom_endpoint_and_discovery_semantics_match_snapshot(self):
        self.assertEqual(self.registry.get("custom").base_url_env_names, ("CUSTOM_BASE_URL",))
        self.assertEqual(self.registry.get("minimax").model_discovery.strategy, "openai_models")
        for slug in ("minimax-cn", "opencode-go"):
            with self.subTest(slug=slug):
                discovery = self.registry.get(slug).model_discovery
                self.assertFalse(discovery.supported)
                self.assertEqual(discovery.strategy, "none")
                self.assertTrue(self.registry.get(slug).manual_model_entry)

    def _fixture(self):
        return copy.deepcopy(self.manifest)

    def _reject(self, mutate):
        fixture = self._fixture()
        mutate(fixture)
        with self.assertRaises(ProviderManifestError):
            ProviderRegistry.from_dict(fixture)

    def test_rejects_invalid_manifest_metadata(self):
        for value in (True, 0, -1, "1"):
            with self.subTest(manifest_version=value):
                self._reject(lambda data, value=value: data.__setitem__("manifest_version", value))
        self._reject(lambda data: data.__setitem__("source_commit", "main"))
        self._reject(lambda data: data.__setitem__("source_paths", []))

    def test_rejects_duplicate_slug_and_bad_key_aliases(self):
        self._reject(lambda data: data["providers"].append(copy.deepcopy(data["providers"][0])))
        self._reject(lambda data: data["providers"][0].__setitem__("key_names", [""]))
        self._reject(lambda data: data["providers"][0].__setitem__("key_names", ["KEY", "KEY"]))
        self._reject(lambda data: data["providers"][0].__setitem__("key_names", ["KEY", "key"]))

    def test_rejects_unknown_transport_and_malformed_capabilities(self):
        self._reject(lambda data: data["providers"][0].__setitem__("transport", "grpc"))
        self._reject(lambda data: data["providers"][0].__setitem__("model_discovery", []))
        self._reject(lambda data: data["providers"][0]["model_discovery"].__setitem__("supported", "yes"))
        self._reject(lambda data: data["providers"][0].__setitem__("manual_model_entry", 1))
        self._reject(lambda data: data["providers"][0].__setitem__("rules", []))
        self._reject(lambda data: data["providers"][0].__setitem__("rules", {"unknown": True}))

    def test_rejects_unsafe_default_urls(self):
        unsafe = (
            "http://example.com/v1",
            "https://user:password@example.com/v1",
            "https://example.com/v1?token=value",
            "https://example.com/v1#fragment",
            "not-a-url",
        )
        for url in unsafe:
            with self.subTest(url=url):
                self._reject(lambda data, url=url: data["providers"][0].__setitem__("default_base_url", url))

    def test_loopback_urls_require_explicit_test_only_opt_in(self):
        fixture = self._fixture()
        fixture["providers"][0]["default_base_url"] = "http://127.0.0.1:11434/v1"
        with self.assertRaises(ProviderManifestError):
            ProviderRegistry.from_dict(fixture)
        registry = ProviderRegistry.from_dict(fixture, allow_loopback=True)
        self.assertEqual(registry.get(fixture["providers"][0]["slug"]).default_base_url, "http://127.0.0.1:11434/v1")

    def test_rejects_all_other_loopback_and_local_lookalike_hosts(self):
        unsafe = (
            "https://127.0.0.2/v1",
            "http://127.255.255.254/v1",
            "https://[::1]/v1",
            "https://localhost.example/v1",
            "https://api.localhost/v1",
            "https://localhost./v1",
            "https://[::1/v1",
        )
        for allow_loopback in (False, True):
            for url in unsafe:
                with self.subTest(allow_loopback=allow_loopback, url=url):
                    fixture = self._fixture()
                    fixture["providers"][0]["default_base_url"] = url
                    with self.assertRaises(ProviderManifestError):
                        ProviderRegistry.from_dict(fixture, allow_loopback=allow_loopback)

    def test_rejects_noncanonical_and_non_global_ip_literals(self):
        unsafe = (
            "https://2130706433/v1",
            "https://127.1/v1",
            "https://0177.0.0.1/v1",
            "https://0x7f000001/v1",
            "https://0.0.0.0/v1",
            "https://10.0.0.1/v1",
            "https://172.16.0.1/v1",
            "https://192.168.1.1/v1",
            "https://169.254.169.254/latest/meta-data",
            "https://224.0.0.1/v1",
            "https://240.0.0.1/v1",
            "https://[::]/v1",
            "https://[fc00::1]/v1",
            "https://[fe80::1]/v1",
            "https://[ff02::1]/v1",
            "https://[2001:db8::1]/v1",
        )
        for allow_loopback in (False, True):
            for url in unsafe:
                with self.subTest(allow_loopback=allow_loopback, url=url):
                    fixture = self._fixture()
                    fixture["providers"][0]["default_base_url"] = url
                    with self.assertRaises(ProviderManifestError):
                        ProviderRegistry.from_dict(fixture, allow_loopback=allow_loopback)

    def test_global_ip_literal_remains_valid(self):
        fixture = self._fixture()
        fixture["providers"][0]["default_base_url"] = "https://8.8.8.8/v1"
        registry = ProviderRegistry.from_dict(fixture)
        self.assertEqual(registry.providers[0].default_base_url, "https://8.8.8.8/v1")

    def test_default_rejects_exact_loopback_even_over_https(self):
        for url in ("https://localhost/v1", "https://127.0.0.1/v1"):
            with self.subTest(url=url):
                fixture = self._fixture()
                fixture["providers"][0]["default_base_url"] = url
                with self.assertRaises(ProviderManifestError):
                    ProviderRegistry.from_dict(fixture)

    def test_loopback_opt_in_requires_boolean_true(self):
        fixture = self._fixture()
        fixture["providers"][0]["default_base_url"] = "http://127.0.0.1/v1"
        for value in (1, "true", None):
            with self.subTest(value=value), self.assertRaises(ProviderManifestError):
                ProviderRegistry.from_dict(fixture, allow_loopback=value)

    def test_null_default_requires_custom_endpoint(self):
        self._reject(lambda data: data["providers"][0].__setitem__("default_base_url", None))
        self._reject(lambda data: data["providers"][0].__setitem__("requires_custom_base_url", "yes"))

    def test_rejects_malformed_typed_rules(self):
        self._reject(
            lambda data: data["providers"][0].__setitem__(
                "rules", {"key_prefix_routes": [{"prefix": 1, "base_url": "https://example.com", "transport": "chat"}]}
            )
        )
        self._reject(
            lambda data: data["providers"][0].__setitem__(
                "rules", {"model_transport_routes": [{"prefixes": [], "transport": "chat"}]}
            )
        )


if __name__ == "__main__":
    unittest.main()
