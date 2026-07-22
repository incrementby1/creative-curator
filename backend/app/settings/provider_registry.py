"""Validated, immutable view of the pinned Hermes provider manifest."""

from __future__ import annotations

import ipaddress
import json
import re
import socket
from dataclasses import InitVar, dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping
from urllib.parse import urlsplit


class ProviderManifestError(ValueError):
    """Raised when provider compatibility metadata is invalid."""


class ProviderNotFound(KeyError):
    """Raised when a provider slug is not present in the manifest."""


@dataclass(frozen=True)
class ModelDiscovery:
    strategy: str
    supported: bool

    def __post_init__(self) -> None:
        if not isinstance(self.strategy, str) or self.strategy not in _DISCOVERY_STRATEGIES:
            raise ProviderManifestError("model discovery has unknown strategy")
        if type(self.supported) is not bool:
            raise ProviderManifestError("model discovery supported must be a boolean")
        if self.supported != (self.strategy != "none"):
            raise ProviderManifestError("model discovery strategy and supported flag disagree")


@dataclass(frozen=True)
class KeyPrefixRoute:
    prefix: str
    base_url: str
    transport: str
    allow_loopback: InitVar[bool] = False

    def __post_init__(self, allow_loopback: bool) -> None:
        _require_bool(allow_loopback, "allow_loopback")
        _require_nonempty_string(self.prefix, "key prefix route prefix")
        _require_route_transport(self.transport, "key prefix route")
        _validate_url(self.base_url, "key prefix route base_url", allow_loopback=allow_loopback)


@dataclass(frozen=True)
class ModelTransportRoute:
    prefixes: tuple[str, ...]
    transport: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "prefixes", _direct_string_tuple(self.prefixes, "model route prefixes"))
        _require_route_transport(self.transport, "model route")


@dataclass(frozen=True)
class EndpointSuffixRoute:
    suffixes: tuple[str, ...]
    transport: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "suffixes", _direct_string_tuple(self.suffixes, "endpoint route suffixes"))
        _require_route_transport(self.transport, "endpoint route")


@dataclass(frozen=True)
class ProviderRules:
    custom_endpoint_required: bool = False
    key_prefix_routes: tuple[KeyPrefixRoute, ...] = ()
    model_transport_routes: tuple[ModelTransportRoute, ...] = ()
    endpoint_suffix_routes: tuple[EndpointSuffixRoute, ...] = ()
    supports_explicit_transport: bool = False
    normalize_anthropic_v1_suffix: bool = False

    def __post_init__(self) -> None:
        for name in (
            "custom_endpoint_required",
            "supports_explicit_transport",
            "normalize_anthropic_v1_suffix",
        ):
            _require_bool(getattr(self, name), f"rules.{name}")
        key_routes = _typed_tuple(self.key_prefix_routes, KeyPrefixRoute, "key prefix routes")
        model_routes = _typed_tuple(self.model_transport_routes, ModelTransportRoute, "model routes")
        endpoint_routes = _typed_tuple(self.endpoint_suffix_routes, EndpointSuffixRoute, "endpoint routes")
        _reject_duplicate_selectors((route.prefix for route in key_routes), "key prefix")
        _reject_duplicate_selectors(
            (prefix for route in model_routes for prefix in route.prefixes), "model prefix"
        )
        _reject_duplicate_selectors(
            (suffix for route in endpoint_routes for suffix in route.suffixes), "endpoint suffix"
        )
        object.__setattr__(self, "key_prefix_routes", key_routes)
        object.__setattr__(self, "model_transport_routes", model_routes)
        object.__setattr__(self, "endpoint_suffix_routes", endpoint_routes)


@dataclass(frozen=True)
class ProviderMetadata:
    slug: str
    display_name: str
    key_names: tuple[str, ...]
    default_base_url: str | None
    base_url_env_names: tuple[str, ...]
    requires_custom_base_url: bool
    transport: str
    model_discovery: ModelDiscovery
    manual_model_entry: bool
    rules: ProviderRules
    allow_loopback: InitVar[bool] = False

    def __post_init__(self, allow_loopback: bool) -> None:
        _require_bool(allow_loopback, "allow_loopback")
        slug = _require_nonempty_string(self.slug, "provider.slug")
        if _SLUG_RE.fullmatch(slug) is None:
            raise ProviderManifestError("provider slug is invalid")
        _require_nonempty_string(self.display_name, f"providers[{slug}].display_name")
        key_names = _direct_string_tuple(
            self.key_names, f"providers[{slug}].key_names", pattern=_ENV_RE
        )
        env_names = _direct_string_tuple(
            self.base_url_env_names,
            f"providers[{slug}].base_url_env_names",
            pattern=_ENV_RE,
            allow_empty=True,
        )
        requires_custom = _require_bool(
            self.requires_custom_base_url, f"providers[{slug}].requires_custom_base_url"
        )
        if self.default_base_url is None:
            if not requires_custom:
                raise ProviderManifestError(f"providers[{slug}] null base URL requires custom endpoint")
        else:
            _validate_url(
                self.default_base_url,
                f"providers[{slug}].default_base_url",
                allow_loopback=allow_loopback,
            )
            if requires_custom:
                raise ProviderManifestError(
                    f"providers[{slug}] cannot require a custom endpoint with a default"
                )
        if self.transport not in _TRANSPORTS:
            raise ProviderManifestError(f"providers[{slug}] has unknown transport")
        if not isinstance(self.model_discovery, ModelDiscovery):
            raise ProviderManifestError(f"providers[{slug}].model_discovery is invalid")
        _require_bool(self.manual_model_entry, f"providers[{slug}].manual_model_entry")
        if isinstance(self.rules, dict):
            rules = _validate_rules(self.rules, slug, allow_loopback=allow_loopback)
        elif isinstance(self.rules, ProviderRules):
            rules = self.rules
            for route in rules.key_prefix_routes:
                _validate_url(
                    route.base_url,
                    f"providers[{slug}].rules.key_prefix_routes base_url",
                    allow_loopback=allow_loopback,
                )
        else:
            raise ProviderManifestError(f"providers[{slug}].rules must be typed rules or an object")
        if requires_custom and not rules.custom_endpoint_required:
            raise ProviderManifestError(f"providers[{slug}] must declare custom endpoint rule")
        object.__setattr__(self, "key_names", key_names)
        object.__setattr__(self, "base_url_env_names", env_names)
        object.__setattr__(self, "rules", rules)


_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_ENV_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
_TRANSPORTS = frozenset({"chat", "responses", "anthropic", "gemini", "copilot", "auto"})
_DISCOVERY_STRATEGIES = frozenset(
    {"openai_models", "anthropic_models", "gemini_models", "copilot_models", "none"}
)
_TOP_FIELDS = frozenset(
    {"manifest_version", "source_repository", "source_commit", "source_paths", "providers"}
)
_PROVIDER_FIELDS = frozenset(
    {
        "slug",
        "display_name",
        "key_names",
        "default_base_url",
        "base_url_env_names",
        "requires_custom_base_url",
        "transport",
        "model_discovery",
        "manual_model_entry",
        "rules",
    }
)
_RULE_FIELDS = frozenset(
    {
        "custom_endpoint_required",
        "key_prefix_routes",
        "model_transport_routes",
        "endpoint_suffix_routes",
        "supports_explicit_transport",
        "normalize_anthropic_v1_suffix",
    }
)


def _require_object(value: Any, location: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProviderManifestError(f"{location} must be an object")
    return value


def _require_exact_fields(value: Mapping[str, Any], expected: frozenset[str], location: str) -> None:
    actual = set(value)
    if actual != expected:
        raise ProviderManifestError(f"{location} fields do not match schema")


def _require_bool(value: Any, location: str) -> bool:
    if type(value) is not bool:
        raise ProviderManifestError(f"{location} must be a boolean")
    return value


def _require_nonempty_string(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProviderManifestError(f"{location} must be a non-empty string")
    return value


def _string_tuple(
    value: Any,
    location: str,
    *,
    pattern: re.Pattern[str] | None = None,
    allow_empty: bool = False,
) -> tuple[str, ...]:
    if not isinstance(value, list) or (not value and not allow_empty):
        raise ProviderManifestError(f"{location} must be a list of strings")
    return _direct_string_tuple(value, location, pattern=pattern, allow_empty=allow_empty)


def _direct_string_tuple(
    value: Any,
    location: str,
    *,
    pattern: re.Pattern[str] | None = None,
    allow_empty: bool = False,
) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)) or (not value and not allow_empty):
        raise ProviderManifestError(f"{location} must be a sequence of strings")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = _require_nonempty_string(item, location)
        if pattern is not None and pattern.fullmatch(text) is None:
            raise ProviderManifestError(f"{location} contains an invalid value")
        folded = text.casefold()
        if folded in seen:
            raise ProviderManifestError(f"{location} contains a duplicate")
        seen.add(folded)
        result.append(text)
    return tuple(result)


def _typed_tuple(value: Any, item_type: type, location: str) -> tuple[Any, ...]:
    if not isinstance(value, (list, tuple)):
        raise ProviderManifestError(f"{location} must be a sequence")
    result = tuple(value)
    if any(not isinstance(item, item_type) for item in result):
        raise ProviderManifestError(f"{location} contains an invalid item")
    return result


def _reject_duplicate_selectors(selectors: Any, location: str) -> None:
    seen: set[str] = set()
    for selector in selectors:
        folded = selector.casefold()
        if folded in seen:
            raise ProviderManifestError(f"duplicate or conflicting {location} selector")
        seen.add(folded)


def _require_route_transport(value: Any, location: str) -> str:
    transport = _require_nonempty_string(value, f"{location} transport")
    if transport not in _TRANSPORTS - {"auto"}:
        raise ProviderManifestError(f"{location} has unknown transport")
    return transport


def _validate_url(value: Any, location: str, *, allow_loopback: bool) -> str:
    _require_bool(allow_loopback, "allow_loopback")
    text = _require_nonempty_string(value, location)
    try:
        parsed = urlsplit(text)
        port = parsed.port
    except ValueError as exc:
        raise ProviderManifestError(f"{location} is invalid") from exc
    host = (parsed.hostname or "").lower()
    exact_test_loopback = host in {"localhost", "127.0.0.1"}
    local_hostname = (
        host.rstrip(".") == "localhost"
        or host.startswith("localhost.")
        or host.endswith(".localhost")
    )
    ip_literal: ipaddress.IPv4Address | ipaddress.IPv6Address | None = None
    legacy_numeric = False
    try:
        ip_literal = ipaddress.ip_address(host)
    except ValueError:
        try:
            packed = socket.inet_aton(host)
        except OSError:
            if re.fullmatch(r"(?:0[xX][0-9a-fA-F]+|[0-9][0-9.]*)", host):
                legacy_numeric = True
        else:
            ip_literal = ipaddress.IPv4Address(packed)
            legacy_numeric = str(ip_literal) != host
    non_global_literal = ip_literal is not None and (
        not ip_literal.is_global
        or ip_literal.is_loopback
        or ip_literal.is_private
        or ip_literal.is_link_local
        or ip_literal.is_multicast
        or ip_literal.is_unspecified
        or ip_literal.is_reserved
    )
    allowed_test_loopback = allow_loopback and exact_test_loopback
    if (
        parsed.scheme.lower() not in ({"http", "https"} if allowed_test_loopback else {"https"})
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or legacy_numeric
        or local_hostname and not allowed_test_loopback
        or non_global_literal and not allowed_test_loopback
    ):
        raise ProviderManifestError(f"{location} must be a safe HTTPS URL")
    if port is not None and not allowed_test_loopback and not 1 <= port <= 65535:
        raise ProviderManifestError(f"{location} has an invalid port")
    return text


def validate_provider_url(value: str, *, allow_loopback: bool = False) -> str:
    """Validate manifest URL syntax without DNS or network access.

    Runtime transports must resolve DNS immediately before connecting and repeat
    validation after every redirect to prevent DNS-rebinding and redirect SSRF.
    """
    return _validate_url(value, "provider URL", allow_loopback=allow_loopback)


def _validate_rules(value: Any, slug: str, *, allow_loopback: bool) -> ProviderRules:
    rules = _require_object(value, f"providers[{slug}].rules")
    if not set(rules).issubset(_RULE_FIELDS):
        raise ProviderManifestError(f"providers[{slug}].rules contains unknown fields")

    booleans: dict[str, bool] = {}
    for name in ("custom_endpoint_required", "supports_explicit_transport", "normalize_anthropic_v1_suffix"):
        booleans[name] = _require_bool(
            rules.get(name, False), f"providers[{slug}].rules.{name}"
        )

    routes = rules.get("key_prefix_routes")
    if routes is not None:
        if not isinstance(routes, list) or not routes:
            raise ProviderManifestError(f"providers[{slug}].rules.key_prefix_routes must be non-empty")
        checked: list[KeyPrefixRoute] = []
        for route in routes:
            route = _require_object(route, f"providers[{slug}].rules.key_prefix_routes")
            _require_exact_fields(route, frozenset({"prefix", "base_url", "transport"}), "key prefix route")
            transport = _require_nonempty_string(route["transport"], "key prefix route transport")
            if transport not in _TRANSPORTS - {"auto"}:
                raise ProviderManifestError("key prefix route has unknown transport")
            checked.append(
                KeyPrefixRoute(
                    prefix=route["prefix"],
                    base_url=route["base_url"],
                    transport=transport,
                    allow_loopback=allow_loopback,
                )
            )
        key_prefix_routes = tuple(checked)
    else:
        key_prefix_routes = ()

    typed_routes: dict[str, tuple[Any, ...]] = {}
    for rule_name in ("model_transport_routes", "endpoint_suffix_routes"):
        routes = rules.get(rule_name)
        if routes is None:
            typed_routes[rule_name] = ()
            continue
        if not isinstance(routes, list) or not routes:
            raise ProviderManifestError(f"providers[{slug}].rules.{rule_name} must be non-empty")
        checked = []
        selector = "prefixes" if rule_name == "model_transport_routes" else "suffixes"
        for route in routes:
            route = _require_object(route, f"providers[{slug}].rules.{rule_name}")
            _require_exact_fields(route, frozenset({selector, "transport"}), f"{rule_name} route")
            transport = _require_nonempty_string(route["transport"], f"{rule_name} transport")
            if transport not in _TRANSPORTS - {"auto"}:
                raise ProviderManifestError(f"{rule_name} has unknown transport")
            selectors = _string_tuple(route[selector], f"{rule_name}.{selector}")
            route_type = ModelTransportRoute if rule_name == "model_transport_routes" else EndpointSuffixRoute
            checked.append(route_type(selectors, transport))
        typed_routes[rule_name] = tuple(checked)

    return ProviderRules(
        custom_endpoint_required=booleans["custom_endpoint_required"],
        key_prefix_routes=key_prefix_routes,
        model_transport_routes=typed_routes["model_transport_routes"],
        endpoint_suffix_routes=typed_routes["endpoint_suffix_routes"],
        supports_explicit_transport=booleans["supports_explicit_transport"],
        normalize_anthropic_v1_suffix=booleans["normalize_anthropic_v1_suffix"],
    )


@dataclass(frozen=True)
class ProviderRegistry:
    """Immutable provider metadata loaded from a versioned JSON snapshot."""

    manifest_version: int
    source_repository: str
    source_commit: str
    source_paths: tuple[str, ...]
    providers: tuple[ProviderMetadata, ...]
    allow_loopback: InitVar[bool] = False
    _by_slug: Mapping[str, ProviderMetadata] = field(init=False, repr=False, compare=False)

    def __post_init__(self, allow_loopback: bool) -> None:
        _require_bool(allow_loopback, "allow_loopback")
        if type(self.manifest_version) is not int or self.manifest_version <= 0:
            raise ProviderManifestError("manifest_version must be a positive integer")
        repository = _validate_url(
            self.source_repository, "source_repository", allow_loopback=False
        ).rstrip("/")
        if repository != "https://github.com/NousResearch/hermes-agent":
            raise ProviderManifestError("source_repository must be the official Hermes repository")
        if not isinstance(self.source_commit, str) or _COMMIT_RE.fullmatch(self.source_commit) is None:
            raise ProviderManifestError(
                "source_commit must be a 40-character lowercase hex commit"
            )
        source_paths = _direct_string_tuple(self.source_paths, "source_paths")
        providers = _typed_tuple(self.providers, ProviderMetadata, "providers")
        if not providers:
            raise ProviderManifestError("providers must be a non-empty sequence")
        seen: set[str] = set()
        for provider in providers:
            folded = provider.slug.casefold()
            if folded in seen:
                raise ProviderManifestError("provider slug is duplicated")
            seen.add(folded)
            if provider.default_base_url is not None:
                _validate_url(
                    provider.default_base_url,
                    f"providers[{provider.slug}].default_base_url",
                    allow_loopback=allow_loopback,
                )
            for route in provider.rules.key_prefix_routes:
                _validate_url(
                    route.base_url,
                    f"providers[{provider.slug}].rules.key_prefix_routes base_url",
                    allow_loopback=allow_loopback,
                )
        object.__setattr__(self, "source_repository", repository)
        object.__setattr__(self, "source_paths", source_paths)
        object.__setattr__(self, "providers", providers)
        object.__setattr__(
            self,
            "_by_slug",
            MappingProxyType({provider.slug: provider for provider in providers}),
        )

    @classmethod
    def load_default(cls) -> "ProviderRegistry":
        path = Path(__file__).with_name("provider_manifest.json")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ProviderManifestError("default provider manifest could not be loaded") from exc
        return cls.from_dict(payload)

    @classmethod
    def from_dict(cls, payload: Any, *, allow_loopback: bool = False) -> "ProviderRegistry":
        root = _require_object(payload, "manifest")
        _require_exact_fields(root, _TOP_FIELDS, "manifest")

        version = root["manifest_version"]
        if type(version) is not int or version <= 0:
            raise ProviderManifestError("manifest_version must be a positive integer")
        repository = _validate_url(root["source_repository"], "source_repository", allow_loopback=False).rstrip("/")
        if repository != "https://github.com/NousResearch/hermes-agent":
            raise ProviderManifestError("source_repository must be the official Hermes repository")
        commit = _require_nonempty_string(root["source_commit"], "source_commit")
        if _COMMIT_RE.fullmatch(commit) is None:
            raise ProviderManifestError("source_commit must be a 40-character lowercase hex commit")
        source_paths = _string_tuple(root["source_paths"], "source_paths")

        raw_providers = root["providers"]
        if not isinstance(raw_providers, list) or not raw_providers:
            raise ProviderManifestError("providers must be a non-empty list")
        providers: list[ProviderMetadata] = []
        seen_slugs: set[str] = set()
        for raw in raw_providers:
            provider = _require_object(raw, "provider")
            _require_exact_fields(provider, _PROVIDER_FIELDS, "provider")
            slug = _require_nonempty_string(provider["slug"], "provider.slug")
            if _SLUG_RE.fullmatch(slug) is None or slug.casefold() in seen_slugs:
                raise ProviderManifestError("provider slug is invalid or duplicated")
            seen_slugs.add(slug.casefold())
            display_name = _require_nonempty_string(provider["display_name"], f"providers[{slug}].display_name")
            key_names = _string_tuple(provider["key_names"], f"providers[{slug}].key_names", pattern=_ENV_RE)
            env_names = _string_tuple(
                provider["base_url_env_names"],
                f"providers[{slug}].base_url_env_names",
                pattern=_ENV_RE,
                allow_empty=True,
            )
            requires_custom = _require_bool(
                provider["requires_custom_base_url"], f"providers[{slug}].requires_custom_base_url"
            )
            default_url = provider["default_base_url"]
            if default_url is None:
                if not requires_custom:
                    raise ProviderManifestError(f"providers[{slug}] null base URL requires custom endpoint")
            else:
                default_url = _validate_url(
                    default_url, f"providers[{slug}].default_base_url", allow_loopback=allow_loopback
                )
                if requires_custom:
                    raise ProviderManifestError(f"providers[{slug}] cannot require a custom endpoint with a default")
            transport = _require_nonempty_string(provider["transport"], f"providers[{slug}].transport")
            if transport not in _TRANSPORTS:
                raise ProviderManifestError(f"providers[{slug}] has unknown transport")

            discovery = _require_object(provider["model_discovery"], f"providers[{slug}].model_discovery")
            _require_exact_fields(discovery, frozenset({"strategy", "supported"}), "model_discovery")
            strategy = _require_nonempty_string(discovery["strategy"], "model_discovery.strategy")
            if strategy not in _DISCOVERY_STRATEGIES:
                raise ProviderManifestError("model_discovery has unknown strategy")
            supported = _require_bool(discovery["supported"], "model_discovery.supported")
            if supported != (strategy != "none"):
                raise ProviderManifestError("model_discovery strategy and supported flag disagree")

            rules = _validate_rules(provider["rules"], slug, allow_loopback=allow_loopback)
            if requires_custom and not rules.custom_endpoint_required:
                raise ProviderManifestError(f"providers[{slug}] must declare custom endpoint rule")
            providers.append(
                ProviderMetadata(
                    slug=slug,
                    display_name=display_name,
                    key_names=key_names,
                    default_base_url=default_url,
                    base_url_env_names=env_names,
                    requires_custom_base_url=requires_custom,
                    transport=transport,
                    model_discovery=ModelDiscovery(strategy=strategy, supported=supported),
                    manual_model_entry=_require_bool(
                        provider["manual_model_entry"], f"providers[{slug}].manual_model_entry"
                    ),
                    rules=rules,
                    allow_loopback=allow_loopback,
                )
            )

        return cls(
            manifest_version=version,
            source_repository=repository,
            source_commit=commit,
            source_paths=source_paths,
            providers=tuple(providers),
            allow_loopback=allow_loopback,
        )

    def slugs(self) -> tuple[str, ...]:
        return tuple(self._by_slug)

    def get(self, slug: str) -> ProviderMetadata:
        try:
            return self._by_slug[slug]
        except KeyError as exc:
            raise ProviderNotFound(slug) from exc
