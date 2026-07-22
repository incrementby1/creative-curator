from __future__ import annotations

import ipaddress
import json
import socket
from dataclasses import dataclass
from typing import Any, Callable, Protocol
from urllib.parse import quote, urlsplit, urlunsplit

import httpx

from app.llm.types import LlmRequest, LlmResult, ProviderFailure, thaw_json
from app.settings.provider_registry import ProviderManifestError, ProviderMetadata, validate_provider_url


MAX_RESPONSE_BYTES = 1_048_576
COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token"
_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)


class HttpClient(Protocol):
    def stream(self, method: str, url: str, **kwargs: Any) -> Any: ...


Resolver = Callable[[str], tuple[str, ...] | list[str]]


def _default_resolver(host: str) -> tuple[str, ...]:
    return tuple({item[4][0] for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)})


@dataclass(frozen=True)
class EndpointPolicy:
    resolver: Resolver = _default_resolver
    allow_loopback: bool = False

    def validate(self, url: str, provider_slug: str) -> "ValidatedEndpoint":
        invalid = False
        endpoint: ValidatedEndpoint | None = None
        try:
            validate_provider_url(url, allow_loopback=self.allow_loopback)
            parsed = urlsplit(url)
            host = parsed.hostname or ""
            try:
                literal = ipaddress.ip_address(host)
            except ValueError:
                literal = None
            addresses = (str(literal),) if literal is not None else tuple(self.resolver(host))
            if not addresses:
                raise ValueError
            exact_loopback = self.allow_loopback and host in {"localhost", "127.0.0.1"}
            validated: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
            for value in addresses:
                address = ipaddress.ip_address(value)
                if not address.is_global and not (exact_loopback and address.is_loopback):
                    raise ValueError
                validated.append(address)
            selected = min(validated, key=lambda address: (address.version, int(address)))
            pinned_host = f"[{selected}]" if selected.version == 6 else str(selected)
            authority = pinned_host + (f":{parsed.port}" if parsed.port is not None else "")
            pinned_url = urlunsplit((parsed.scheme, authority, parsed.path, "", ""))
            endpoint = ValidatedEndpoint(
                original_url=url,
                pinned_url=pinned_url,
                host_header=parsed.netloc,
                sni_hostname=host if parsed.scheme == "https" else None,
            )
        except Exception:
            invalid = True
        if invalid:
            raise ProviderFailure(provider_slug, "configuration", False)
        assert endpoint is not None
        return endpoint


@dataclass(frozen=True)
class ValidatedEndpoint:
    original_url: str
    pinned_url: str
    host_header: str
    sni_hostname: str | None


@dataclass(frozen=True)
class ProviderRoute:
    base_url: str
    transport: str


def resolve_provider_route(
    provider: ProviderMetadata, model: str, api_key: str, supplied_base_url: str | None
) -> ProviderRoute:
    base_url = supplied_base_url or provider.default_base_url
    transport: str | None = None
    for route in provider.rules.key_prefix_routes:
        if api_key.startswith(route.prefix):
            base_url, transport = route.base_url, route.transport
            break
    if base_url is None:
        raise ProviderFailure(provider.slug, "configuration", False) from None
    try:
        validate_provider_url(base_url)
    except ProviderManifestError:
        raise ProviderFailure(provider.slug, "configuration", False) from None
    path = urlsplit(base_url).path.rstrip("/").casefold()
    if transport is None:
        for route in provider.rules.endpoint_suffix_routes:
            if any(path.endswith(suffix.casefold().rstrip("/")) for suffix in route.suffixes):
                transport = route.transport
                break
    if transport is None:
        folded_model = model.casefold()
        for route in provider.rules.model_transport_routes:
            if any(folded_model.startswith(prefix.casefold()) for prefix in route.prefixes):
                transport = route.transport
                break
    if transport is None:
        transport = provider.transport if provider.transport != "auto" else "chat"
    if transport == "anthropic" and provider.rules.normalize_anthropic_v1_suffix:
        base_url = _anthropic_base(base_url)
    return ProviderRoute(base_url.rstrip("/"), transport)


def _join(base: str, suffix: str) -> str:
    return f"{base.rstrip('/')}/{suffix.lstrip('/')}"


def _anthropic_base(base: str) -> str:
    return base.rstrip("/")


def _user_content(request: LlmRequest) -> str:
    encoded = json.dumps(thaw_json(request.user_json), ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)
    return f"USER_DATA_JSON\n{encoded}\nEND_USER_DATA_JSON"


class LlmDispatcher:
    def __init__(
        self,
        *,
        endpoint_policy: EndpointPolicy | None = None,
        test_client: HttpClient | None = None,
        allow_test_client: bool = False,
    ):
        if test_client is not None and not allow_test_client:
            raise ValueError("Injected HTTP clients require explicit test opt-in.")
        if allow_test_client and test_client is None:
            raise ValueError("Test client opt-in requires a test client.")
        self._owns_http = test_client is None
        self._closed = False
        self._http = test_client or httpx.Client(
            timeout=_TIMEOUT,
            follow_redirects=False,
            trust_env=False,
            limits=httpx.Limits(max_keepalive_connections=0),
        )
        self._policy = endpoint_policy or EndpointPolicy()

    def close(self) -> None:
        if self._owns_http and not self._closed:
            self._http.close()
            self._closed = True

    def __enter__(self) -> "LlmDispatcher":
        return self

    def __exit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        self.close()

    def dispatch(self, request: LlmRequest, transport: str) -> LlmResult:
        failure: ProviderFailure | None = None
        try:
            if transport == "chat":
                text = self._chat(request)
            elif transport == "responses":
                text = self._responses(request)
            elif transport == "anthropic":
                text = self._anthropic(request)
            elif transport == "gemini":
                text = self._gemini(request)
            elif transport == "copilot":
                text = self._copilot(request)
            else:
                raise ProviderFailure(request.provider_slug, "configuration", False)
            return LlmResult(text, request.provider_slug, request.model)
        except ProviderFailure:
            raise
        except httpx.TimeoutException:
            failure = ProviderFailure(request.provider_slug, "timeout", True)
        except httpx.TransportError:
            failure = ProviderFailure(request.provider_slug, "unavailable", True)
        except Exception:
            failure = ProviderFailure(request.provider_slug, "invalid_response", False)
        raise failure

    def _send(self, request: LlmRequest, url: str, headers: dict[str, str],
              payload: dict[str, Any] | None, *, method: str = "POST") -> Any:
        endpoint = self._policy.validate(url, request.provider_slug)
        failure: ProviderFailure | None = None
        captured = b""
        try:
            safe_headers = dict(headers)
            safe_headers["Host"] = endpoint.host_header
            extensions = (
                {"sni_hostname": endpoint.sni_hostname}
                if endpoint.sni_hostname is not None
                else {}
            )
            kwargs = {
                "headers": safe_headers,
                "timeout": _TIMEOUT,
                "follow_redirects": False,
                "extensions": extensions,
            }
            if payload is not None:
                kwargs["json"] = payload
            with self._http.stream(method, endpoint.pinned_url, **kwargs) as response:
                failure = _status_failure(request.provider_slug, response.status_code)
                if failure is None:
                    length = _content_length(response.headers)
                    if length is not None and length > MAX_RESPONSE_BYTES:
                        failure = ProviderFailure(request.provider_slug, "invalid_response", False)
                    else:
                        buffer = bytearray()
                        for chunk in response.iter_bytes():
                            room = MAX_RESPONSE_BYTES + 1 - len(buffer)
                            if room > 0:
                                buffer.extend(chunk[:room])
                            if len(buffer) > MAX_RESPONSE_BYTES:
                                failure = ProviderFailure(request.provider_slug, "invalid_response", False)
                                break
                        captured = bytes(buffer)
        except httpx.TimeoutException:
            failure = ProviderFailure(request.provider_slug, "timeout", True)
        except httpx.TransportError:
            failure = ProviderFailure(request.provider_slug, "unavailable", True)
        except ProviderFailure as exc:
            failure = exc
        if failure is not None:
            raise failure
        if not captured:
            raise ProviderFailure(request.provider_slug, "invalid_response", False) from None
        malformed = False
        try:
            body = json.loads(captured)
        except Exception:
            malformed = True
            body = None
        if malformed:
            raise ProviderFailure(request.provider_slug, "invalid_response", False)
        if not isinstance(body, dict):
            raise ProviderFailure(request.provider_slug, "invalid_response", False) from None
        return body

    def _chat(self, request: LlmRequest, *, base_url: str | None = None, api_key: str | None = None) -> str:
        body = self._send(request, _join(base_url or request.base_url, "chat/completions"),
                          {"Authorization": f"Bearer {api_key or request.api_key}", "Content-Type": "application/json"},
                          {"model": request.model, "messages": [
                              {"role": "system", "content": request.system_prompt},
                              {"role": "user", "content": _user_content(request)},
                          ]})
        try: text = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError): text = None
        return self._text(text, request)

    def _responses(self, request: LlmRequest) -> str:
        body = self._send(request, _join(request.base_url, "responses"),
                          {"Authorization": f"Bearer {request.api_key}", "Content-Type": "application/json"},
                          {"model": request.model, "instructions": request.system_prompt, "input": _user_content(request)})
        text = body.get("output_text")
        if not isinstance(text, str) or not text:
            chunks: list[str] = []
            for output in body.get("output", []) if isinstance(body.get("output"), list) else []:
                for item in output.get("content", []) if isinstance(output, dict) else []:
                    if isinstance(item, dict):
                        value = item.get("text") or item.get("output_text")
                        if isinstance(value, str): chunks.append(value)
            text = "".join(chunks)
        return self._text(text, request)

    def _anthropic(self, request: LlmRequest) -> str:
        base = request.base_url.rstrip("/")
        url = _join(base, "messages") if base.casefold().endswith("/v1") else _join(base, "v1/messages")
        body = self._send(request, url,
                          {"x-api-key": request.api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
                          {"model": request.model, "max_tokens": 4096, "system": request.system_prompt,
                           "messages": [{"role": "user", "content": _user_content(request)}]})
        chunks = [item.get("text", "") for item in body.get("content", []) if isinstance(item, dict) and item.get("type") == "text"]
        return self._text("".join(chunks), request)

    def _gemini(self, request: LlmRequest) -> str:
        url = _join(request.base_url, f"models/{quote(request.model, safe='')}:generateContent")
        body = self._send(request, url, {"x-goog-api-key": request.api_key, "Content-Type": "application/json"}, {
            "systemInstruction": {"parts": [{"text": request.system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": _user_content(request)}]}],
        })
        chunks: list[str] = []
        for candidate in body.get("candidates", []):
            if isinstance(candidate, dict):
                for part in candidate.get("content", {}).get("parts", []):
                    if isinstance(part, dict) and isinstance(part.get("text"), str): chunks.append(part["text"])
        return self._text("".join(chunks), request)

    def _copilot(self, request: LlmRequest) -> str:
        body = self._send(request, COPILOT_TOKEN_URL,
                          {"Authorization": f"token {request.api_key}"}, None, method="GET")
        token = body.get("token")
        endpoints = body.get("endpoints")
        endpoint = endpoints.get("api") if isinstance(endpoints, dict) else body.get("endpoint")
        if not isinstance(token, str) or not token or not isinstance(endpoint, str):
            raise ProviderFailure(request.provider_slug, "invalid_response", False) from None
        return self._chat(request, base_url=endpoint, api_key=token)

    @staticmethod
    def _text(value: Any, request: LlmRequest) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ProviderFailure(request.provider_slug, "invalid_response", False) from None
        return value


def _status_failure(provider_slug: str, status: int) -> ProviderFailure | None:
    if status in (401, 403):
        return ProviderFailure(provider_slug, "auth", False)
    if status == 408:
        return ProviderFailure(provider_slug, "timeout", True)
    if status == 429:
        return ProviderFailure(provider_slug, "rate_limited", True)
    if 500 <= status <= 599:
        return ProviderFailure(provider_slug, "unavailable", True)
    if 300 <= status <= 399:
        return ProviderFailure(provider_slug, "invalid_response", False)
    if 400 <= status <= 499:
        return ProviderFailure(provider_slug, "configuration", False)
    return None


def _content_length(headers: Any) -> int | None:
    value = headers.get("content-length") if hasattr(headers, "get") else None
    if value is None and hasattr(headers, "get"):
        value = headers.get("Content-Length")
    try:
        parsed = int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
    return parsed if parsed is not None and parsed >= 0 else None
