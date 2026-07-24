# Authenticated Hermes-Compatible BYOK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add basic Supabase email/password login, persistent encrypted per-user API keys, Hermes-compatible provider/model routing, real LLM-backed creative agents, and a precise accessible product UI.

**Architecture:** Supabase Auth establishes identity, FastAPI enforces user ownership, and a dedicated vault encrypts provider credentials before local Supabase persistence. A versioned Hermes-compatible provider manifest drives request-scoped transports and fallback routing; existing Hermes workflow rules stay deterministic while creative content comes from schema-validated LLM responses. Next.js 16 uses Supabase SSR cookies, protected route groups, a shared workspace provider, and Clear Workbench design tokens.

**Tech Stack:** Python 3.11, FastAPI, Pydantic 2, httpx, cryptography AES-GCM, Supabase Python, unittest/TestClient, Next.js 16.2, React 19, TypeScript, `@supabase/ssr`, `@supabase/supabase-js`, Playwright, local Supabase CLI/Docker, Impeccable, UI/UX Pro Max, 21st MCP.

**Safety boundary:** Use only in-memory stores or a Supabase URL proven to target `localhost` or `127.0.0.1`. Never link, push, migrate, test, or mutate remote Supabase. Production hardening remains explicitly deferred.

---

## File structure

Backend boundaries:

- `backend/app/config.py`: validated runtime modes and environment values.
- `backend/app/auth/identity.py`: identity type, verifier protocol, Supabase verifier, test verifier, FastAPI dependency.
- `backend/app/security/credential_cipher.py`: AES-GCM encryption, decryption, masking, and key-version handling.
- `backend/app/settings/types.py`: provider credential and routing domain types.
- `backend/app/settings/provider_manifest.json`: versioned Hermes-compatible public metadata.
- `backend/app/settings/provider_registry.py`: manifest loading and validation.
- `backend/app/persistence/settings_store.py`: in-memory and Supabase credential/routing stores.
- `backend/app/llm/types.py`: transport requests, results, and safe error categories.
- `backend/app/llm/transports.py`: OpenAI-compatible, Responses, Anthropic, Gemini, and Copilot exchange adapters.
- `backend/app/llm/router.py`: primary/fallback selection, decryption, repair, and aggregate errors.
- `backend/app/llm/schemas.py`: typed agent output schemas and semantic validation.
- `backend/app/llm/svg_renderer.py`: safe deterministic SVG rendering from an LLM-generated layout spec.
- `backend/app/api/settings.py`: masked provider and routing HTTP contract.
- Existing agent files: prompt construction and typed LLM conversion only.
- Existing `backend/app/core/hermes.py`: authenticated workflow ownership, transitions, atomic persistence, idempotency.

Client boundaries:

- `client/app/lib/supabase/{browser,server,proxy}.ts`: Supabase SSR client creation and cookie refresh.
- `client/app/lib/auth.ts`: production/test auth-client interface.
- `client/app/components/auth/{auth-provider,auth-form}.tsx`: restored auth state and accessible login/signup form.
- `client/proxy.ts`: protected-route redirect and session refresh using Next.js 16 proxy convention.
- `client/app/lib/{api-client,settings-api}.ts`: bearer-aware JSON transport and typed settings contract.
- `client/app/(protected)/layout.tsx`: shared auth, workspace state, and application shell across Workspace and Settings.
- `client/app/(protected)/settings/*`: provider rows, inline editor, and routing form.
- `client/app/styles/*.css`: tokens, shell, forms, workspace, and settings styles with focused ownership.
- Existing workspace components: behavior retained, presentation aligned to `DESIGN.md`.

### Task 1: Add validated runtime configuration

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/tests/test_config.py`
- Modify: `backend/requirements.txt`
- Modify: `client/package.json`
- Modify: `client/package-lock.json`

- [ ] **Step 1: Write failing backend configuration tests**

```python
import base64
import os
import unittest
from unittest.mock import patch

from app.config import RuntimeConfig


class RuntimeConfigTests(unittest.TestCase):
    def test_persistent_mode_requires_local_supabase_and_master_key(self) -> None:
        key = base64.b64encode(b"k" * 32).decode()
        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "SUPABASE_SERVICE_ROLE_KEY": "local-role",
            "SUPABASE_ANON_KEY": "local-anon",
            "BYOK_MASTER_KEY": key,
        }, clear=True):
            config = RuntimeConfig.from_env()
        self.assertEqual(config.master_key, b"k" * 32)
        self.assertEqual(config.auth_mode, "supabase")

    def test_remote_supabase_is_rejected(self) -> None:
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "remote-role",
            "BYOK_MASTER_KEY": base64.b64encode(b"k" * 32).decode(),
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "localhost or 127.0.0.1"):
                RuntimeConfig.from_env()

    def test_test_mode_is_rejected_in_production(self) -> None:
        with patch.dict(os.environ, {"AUTH_MODE": "test", "APP_ENV": "production"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "test mode"):
                RuntimeConfig.from_env()

    def test_malformed_master_key_fails_closed(self) -> None:
        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://localhost:54321",
            "SUPABASE_SERVICE_ROLE_KEY": "local-role",
            "BYOK_MASTER_KEY": "not-base64!",
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "BYOK_MASTER_KEY"):
                RuntimeConfig.from_env()
```

- [ ] **Step 2: Run the test and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_config -v`.

Expected: import failure because `app.config` does not exist.

- [ ] **Step 3: Implement strict configuration and install dependencies**

```python
@dataclass(frozen=True)
class RuntimeConfig:
    app_env: str
    auth_mode: Literal["supabase", "test"]
    settings_store_mode: Literal["supabase", "memory"]
    llm_transport_mode: Literal["live", "test"]
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    master_key: bytes

    @classmethod
    def from_env(cls) -> "RuntimeConfig":
        app_env = os.getenv("APP_ENV", "development")
        auth_mode = cast(Literal["supabase", "test"], os.getenv("AUTH_MODE", "supabase"))
        store_mode = cast(Literal["supabase", "memory"], os.getenv("SETTINGS_STORE_MODE", "supabase"))
        transport_mode = cast(Literal["live", "test"], os.getenv("LLM_TRANSPORT_MODE", "live"))
        if app_env == "production" and (auth_mode == "test" or transport_mode == "test"):
            raise RuntimeError("test mode is forbidden in production")
        url = os.getenv("SUPABASE_URL", "")
        if auth_mode == "supabase" or store_mode == "supabase":
            require_local_supabase_url(url)
        encoded = os.getenv("BYOK_MASTER_KEY", "")
        try:
            master_key = base64.b64decode(encoded, validate=True) if encoded else b""
        except (binascii.Error, ValueError) as exc:
            raise RuntimeError("BYOK_MASTER_KEY must be valid base64") from exc
        if store_mode == "supabase" and len(master_key) != 32:
            raise RuntimeError("BYOK_MASTER_KEY must decode to exactly 32 bytes")
        return cls(app_env, auth_mode, store_mode, transport_mode, url,
                   os.getenv("SUPABASE_ANON_KEY", ""),
                   os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""), master_key)
```

Add `cryptography>=43,<46` to backend requirements. Add `@supabase/ssr`, `@supabase/supabase-js`, and `lucide-react` to client dependencies with `npm install` from `client`.

- [ ] **Step 4: Run tests and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest tests.test_config -v`.

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/test_config.py backend/requirements.txt client/package.json client/package-lock.json
git commit -m "build: add auth and BYOK runtime dependencies"
```

### Task 2: Add local schema and user-owned session storage

**Files:**
- Create: `supabase/migrations/20260722090000_add_auth_and_byok_settings.sql`
- Create: `supabase/manual/rollback_auth_and_byok_settings.sql`
- Modify: `backend/app/core/types.py`
- Modify: `backend/app/persistence/session_store.py`
- Modify: `backend/tests/test_hermes.py`
- Modify: `backend/tests/test_supabase_store.py`

- [ ] **Step 1: Write failing ownership tests**

```python
def test_user_cannot_load_another_users_session(self) -> None:
    store = InMemorySessionStore()
    store.create("user-a", "session-1", {"session_id": "session-1"})
    self.assertIsNone(store.get("user-b", "session-1"))

def test_hermes_hides_foreign_session(self) -> None:
    store = InMemorySessionStore()
    hermes = Hermes(store=store)
    session = hermes.start_session("user-a", "Acme", "A sufficiently detailed brief.")
    with self.assertRaises(SessionNotFoundError):
        hermes.get_session("user-b", session["session_id"])
```

- [ ] **Step 2: Run focused tests and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_hermes tests.test_supabase_store -v`.

Expected: signature failures because stores and Hermes do not accept `user_id`.

- [ ] **Step 3: Create migration and update ownership signatures**

Migration SQL must execute in this order:

```sql
truncate table public.creative_sessions;
alter table public.creative_sessions
  add column user_id uuid not null references auth.users(id) on delete cascade;
create index creative_sessions_user_id_idx on public.creative_sessions(user_id);

create table public.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_slug text not null,
  ciphertext text not null,
  nonce text not null,
  key_version integer not null default 1,
  masked_suffix text not null,
  base_url text,
  connection_state text not null check (connection_state in ('connected', 'needs_attention')),
  tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider_slug)
);

create table public.user_ai_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  primary_provider_slug text,
  primary_model text,
  fallbacks jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.provider_credentials enable row level security;
alter table public.user_ai_settings enable row level security;
```

Do not add permissive anon policies for credential tables. Rollback drops new tables, index, and `creative_sessions.user_id` in reverse order.

Change store protocol to:

```python
class SessionStore(Protocol):
    def create(self, user_id: str, session_id: str, state: dict) -> None: ...
    def get(self, user_id: str, session_id: str) -> dict | None: ...
    def save(self, user_id: str, session_id: str, state: dict) -> None: ...
```

Key in-memory rows by `(user_id, session_id)` and add `.eq("user_id", user_id)` to every Supabase query. Add `user_id` to `CreativeSession` serialization.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest tests.test_hermes tests.test_supabase_store -v`.

Expected: ownership and existing atomic-persistence tests pass; guarded live tests skip without local variables.

- [ ] **Step 5: Commit**

```bash
git add supabase backend/app/core/types.py backend/app/persistence/session_store.py backend/tests/test_hermes.py backend/tests/test_supabase_store.py
git commit -m "feat: scope creative sessions to users"
```

### Task 3: Verify Supabase identity and protect creative routes

**Files:**
- Create: `backend/app/auth/__init__.py`
- Create: `backend/app/auth/identity.py`
- Create: `backend/tests/test_auth.py`
- Modify: `backend/app/api/creative.py`
- Modify: `backend/tests/test_creative_api.py`

- [ ] **Step 1: Write failing auth and API tests**

```python
class FakeVerifier:
    def verify(self, token: str) -> UserIdentity:
        if token == "valid-a":
            return UserIdentity(user_id="user-a", email="a@example.test")
        raise InvalidAccessToken("invalid or expired token")

def test_missing_bearer_token_is_401(self) -> None:
    response = self.client.post("/creative/start", json=START_PAYLOAD)
    self.assertEqual(response.status_code, 401)

def test_valid_identity_owns_created_session(self) -> None:
    response = self.client.post(
        "/creative/start", json=START_PAYLOAD,
        headers={"Authorization": "Bearer valid-a"},
    )
    self.assertEqual(response.status_code, 201)
    self.assertEqual(self.coordinator.get_session("user-a", response.json()["session_id"])["user_id"], "user-a")
```

- [ ] **Step 2: Run tests and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_auth tests.test_creative_api -v`.

Expected: missing identity module and unprotected route failures.

- [ ] **Step 3: Implement typed identity dependency**

```python
@dataclass(frozen=True)
class UserIdentity:
    user_id: str
    email: str

class IdentityVerifier(Protocol):
    def verify(self, token: str) -> UserIdentity: ...

class TestIdentityVerifier:
    def verify(self, token: str) -> UserIdentity:
        if token.startswith("test-user:"):
            user_id = token.removeprefix("test-user:")
            return UserIdentity(user_id=user_id, email=f"{user_id}@example.test")
        raise InvalidAccessToken("invalid or expired token")

class SupabaseIdentityVerifier:
    def __init__(self, client: Client) -> None:
        self._client = client

    def verify(self, token: str) -> UserIdentity:
        try:
            response = self._client.auth.get_user(token)
            user = response.user
        except Exception as exc:
            raise InvalidAccessToken("invalid or expired token") from exc
        if user is None or not user.id:
            raise InvalidAccessToken("invalid or expired token")
        return UserIdentity(str(user.id), user.email or "")
```

`get_current_user` extracts HTTP Bearer credentials, converts verifier errors to `401`, and creative route handlers pass `identity.user_id` into every Hermes call. Override both `get_identity_verifier` and `get_hermes` in API tests.

- [ ] **Step 4: Run tests and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest tests.test_auth tests.test_creative_api -v`.

Expected: auth tests and updated creative API tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth backend/app/api/creative.py backend/tests/test_auth.py backend/tests/test_creative_api.py
git commit -m "feat: authenticate creative API requests"
```

### Task 4: Build encrypted credential vault and routing stores

**Files:**
- Create: `backend/app/security/__init__.py`
- Create: `backend/app/security/credential_cipher.py`
- Create: `backend/app/security/redaction.py`
- Create: `backend/app/settings/__init__.py`
- Create: `backend/app/settings/types.py`
- Create: `backend/app/persistence/settings_store.py`
- Create: `backend/tests/test_credential_cipher.py`
- Create: `backend/tests/test_redaction.py`
- Create: `backend/tests/test_settings_store.py`

- [ ] **Step 1: Write failing encryption and store tests**

```python
def test_cipher_binds_secret_to_user_and_provider(self) -> None:
    cipher = CredentialCipher(b"k" * 32)
    encrypted = cipher.encrypt("user-a", "openrouter", "sk-secret")
    self.assertEqual(cipher.decrypt("user-a", "openrouter", encrypted), "sk-secret")
    with self.assertRaises(CredentialDecryptionError):
        cipher.decrypt("user-b", "openrouter", encrypted)

def test_encryption_uses_unique_nonce_and_masks_only_suffix(self) -> None:
    cipher = CredentialCipher(b"k" * 32)
    first = cipher.encrypt("user-a", "openrouter", "sk-secret-4F2A")
    second = cipher.encrypt("user-a", "openrouter", "sk-secret-4F2A")
    self.assertNotEqual(first.nonce, second.nonce)
    self.assertEqual(first.masked_suffix, "4F2A")
    self.assertNotIn("secret", first.ciphertext)

def test_wrong_master_key_cannot_decrypt(self) -> None:
    encrypted = CredentialCipher(b"a" * 32).encrypt("user-a", "openrouter", "sk-secret")
    with self.assertRaises(CredentialDecryptionError):
        CredentialCipher(b"b" * 32).decrypt("user-a", "openrouter", encrypted)

def test_routing_update_rejects_stale_version(self) -> None:
    store = InMemorySettingsStore()
    current = store.get_routing("user-a")
    store.save_routing("user-a", RoutingSettings("openrouter", "model-a", (), current.version))
    with self.assertRaises(SettingsVersionConflict):
        store.save_routing("user-a", RoutingSettings("openrouter", "model-b", (), current.version))

def test_redaction_removes_credentials_from_nested_log_context(self) -> None:
    value = redact_sensitive({
        "authorization": "Bearer secret-token",
        "request": {"api_key": "sk-secret", "model": "model-a"},
    })
    self.assertEqual(value["authorization"], "[REDACTED]")
    self.assertEqual(value["request"]["api_key"], "[REDACTED]")
    self.assertEqual(value["request"]["model"], "model-a")
```

- [ ] **Step 2: Run tests and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_credential_cipher tests.test_redaction tests.test_settings_store -v`.

Expected: modules do not exist.

- [ ] **Step 3: Implement focused vault types and stores**

```python
@dataclass(frozen=True)
class EncryptedCredential:
    ciphertext: str
    nonce: str
    key_version: int
    masked_suffix: str

class CredentialCipher:
    def encrypt(self, user_id: str, provider_slug: str, plaintext: str) -> EncryptedCredential:
        nonce = os.urandom(12)
        aad = f"{user_id}:{provider_slug}:1".encode()
        ciphertext = AESGCM(self._key).encrypt(nonce, plaintext.encode(), aad)
        return EncryptedCredential(
            base64.b64encode(ciphertext).decode(),
            base64.b64encode(nonce).decode(), 1, plaintext[-4:],
        )
```

`decrypt` reconstructs the same AAD and wraps invalid base64, nonce length, or AES-GCM authentication failures as `CredentialDecryptionError` without including ciphertext or plaintext in the message.

Define `ProviderCredentialRecord`, `ProviderConnection`, `RouteTarget`, and `RoutingSettings`. `SettingsStore` exposes list/get/upsert/delete credentials plus get/save routing. Supabase implementation filters every query by `user_id`, returns masked domain records, and uses compare-and-swap `.eq("version", expected_version)` for routing updates.

`redact_sensitive` recursively replaces values under `authorization`, `api_key`, `access_token`, `refresh_token`, `ciphertext`, and `nonce` with `[REDACTED]`. HTTP and LLM error logging passes structured context through this function; request headers and upstream response bodies are never logged.

- [ ] **Step 4: Run tests and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest tests.test_credential_cipher tests.test_redaction tests.test_settings_store -v`.

Expected: cipher and in-memory store tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/security backend/app/settings backend/app/persistence/settings_store.py backend/tests/test_credential_cipher.py backend/tests/test_redaction.py backend/tests/test_settings_store.py
git commit -m "feat: encrypt and persist user AI settings"
```

### Task 5: Pin Hermes API-key provider compatibility

**Files:**
- Create: `backend/app/settings/provider_manifest.json`
- Create: `backend/app/settings/provider_registry.py`
- Create: `backend/tests/test_provider_registry.py`

- [ ] **Step 1: Write failing manifest contract tests**

```python
EXPECTED = {
    "openrouter", "custom", "openai-api", "copilot", "gemini", "zai",
    "kimi-coding", "kimi-coding-cn", "stepfun", "arcee", "gmi", "minimax",
    "anthropic", "alibaba", "alibaba-coding-plan", "minimax-cn", "deepseek",
    "xai", "nvidia", "opencode-zen", "opencode-go", "kilocode", "huggingface",
    "xiaomi", "tencent-tokenhub", "ollama-cloud", "azure-foundry", "novita",
}

def test_manifest_is_complete_and_versioned(self) -> None:
    registry = ProviderRegistry.load_default()
    self.assertEqual(set(registry.slugs()), EXPECTED)
    self.assertRegex(registry.source_commit, r"^[0-9a-f]{40}$")
    for provider in registry.providers:
        self.assertTrue(provider.key_names)
        self.assertIn(provider.transport, {"chat", "responses", "anthropic", "gemini", "copilot", "auto"})
```

- [ ] **Step 2: Run test and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_provider_registry -v`.

Expected: registry and manifest do not exist.

- [ ] **Step 3: Create exact provider manifest and validation**

Use official Hermes `hermes_cli/auth.py`, plugin provider profiles, and environment-variable reference at one recorded 40-character commit. Record `source_repository`, `source_commit`, `source_paths`, and entries with these mappings:

| Slug | Key names | Default base URL | Transport |
| --- | --- | --- | --- |
| openrouter | OPENROUTER_API_KEY | https://openrouter.ai/api/v1 | chat |
| custom | OPENAI_API_KEY | user supplied | auto |
| openai-api | OPENAI_API_KEY | https://api.openai.com/v1 | responses |
| copilot | COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN | https://api.githubcopilot.com | copilot |
| gemini | GOOGLE_API_KEY, GEMINI_API_KEY | https://generativelanguage.googleapis.com/v1beta | gemini |
| zai | GLM_API_KEY, ZAI_API_KEY, Z_AI_API_KEY | https://api.z.ai/api/paas/v4 | chat |
| kimi-coding | KIMI_API_KEY, KIMI_CODING_API_KEY | https://api.moonshot.ai/v1 | auto |
| kimi-coding-cn | KIMI_CN_API_KEY | https://api.moonshot.cn/v1 | chat |
| stepfun | STEPFUN_API_KEY | https://api.stepfun.ai/step_plan/v1 | chat |
| arcee | ARCEEAI_API_KEY | https://api.arcee.ai/api/v1 | chat |
| gmi | GMI_API_KEY | https://api.gmi-serving.com/v1 | chat |
| minimax | MINIMAX_API_KEY | https://api.minimax.io/anthropic | anthropic |
| anthropic | ANTHROPIC_API_KEY, ANTHROPIC_TOKEN | https://api.anthropic.com | anthropic |
| alibaba | DASHSCOPE_API_KEY | https://dashscope-intl.aliyuncs.com/compatible-mode/v1 | chat |
| alibaba-coding-plan | ALIBABA_CODING_PLAN_API_KEY, DASHSCOPE_API_KEY | https://coding-intl.dashscope.aliyuncs.com/v1 | chat |
| minimax-cn | MINIMAX_CN_API_KEY | https://api.minimaxi.com/anthropic | anthropic |
| deepseek | DEEPSEEK_API_KEY | https://api.deepseek.com/v1 | chat |
| xai | XAI_API_KEY | https://api.x.ai/v1 | responses |
| nvidia | NVIDIA_API_KEY | https://integrate.api.nvidia.com/v1 | chat |
| opencode-zen | OPENCODE_ZEN_API_KEY | https://opencode.ai/zen/v1 | chat |
| opencode-go | OPENCODE_GO_API_KEY | https://opencode.ai/zen/go/v1 | auto |
| kilocode | KILOCODE_API_KEY | https://api.kilo.ai/api/gateway | chat |
| huggingface | HF_TOKEN | https://router.huggingface.co/v1 | chat |
| xiaomi | XIAOMI_API_KEY | https://api.xiaomimimo.com/v1 | chat |
| tencent-tokenhub | TOKENHUB_API_KEY | https://tokenhub.tencentmaas.com/v1 | chat |
| ollama-cloud | OLLAMA_API_KEY | https://ollama.com/v1 | chat |
| azure-foundry | AZURE_FOUNDRY_API_KEY | user supplied | auto |
| novita | NOVITA_API_KEY | https://api.novita.ai/openai/v1 | chat |

Exclude LM Studio because this milestone excludes local no-key runtimes. Exclude OAuth, AWS SDK, and external-process entries. Registry validation rejects duplicate slugs, empty keys, unknown transports, non-HTTPS defaults except explicit loopback test fixtures, and missing custom endpoint requirements.

- [ ] **Step 4: Run test and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest tests.test_provider_registry -v`.

Expected: manifest contract passes with exact slug set.

- [ ] **Step 5: Commit**

```bash
git add backend/app/settings/provider_manifest.json backend/app/settings/provider_registry.py backend/tests/test_provider_registry.py
git commit -m "feat: pin Hermes provider compatibility"
```

### Task 6: Implement transports, fallback routing, and repair

**Files:**
- Create: `backend/app/llm/types.py`
- Create: `backend/app/llm/transports.py`
- Replace: `backend/app/core/llm_router.py`
- Create: `backend/app/llm/router.py`
- Create: `backend/tests/test_llm_transports.py`
- Create: `backend/tests/test_llm_router.py`

- [ ] **Step 1: Write failing transport and routing tests**

```python
class ExampleOutput(BaseModel):
    value: str

def test_router_falls_back_after_rate_limit(self) -> None:
    transport = FakeTransport([
        ProviderFailure("openrouter", "rate_limited", retriable=True),
        '{"value":"fallback"}',
    ])
    result = self.router(transport).generate("user-a", ExampleOutput, "system", {"brand": "Acme"})
    self.assertEqual(result.value, "fallback")
    self.assertEqual(transport.models, ["primary-model", "fallback-model"])

def test_invalid_json_repairs_once_then_falls_back(self) -> None:
    transport = FakeTransport(["not-json", '{"wrong":true}', '{"value":"repaired"}'])
    result = self.router(transport).generate("user-a", ExampleOutput, "system", {"brand": "Acme"})
    self.assertEqual(result.value, "repaired")
    self.assertEqual(transport.call_count, 3)

def test_safe_error_never_contains_key_or_upstream_body(self) -> None:
    transport = FakeTransport([ProviderFailure("openrouter", "auth", False, "sk-secret raw body")])
    with self.assertRaises(AllProvidersFailed) as raised:
        self.router(transport).generate("user-a", ExampleOutput, "system", {})
    self.assertNotIn("sk-secret", str(raised.exception))
```

- [ ] **Step 2: Run tests and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_llm_transports tests.test_llm_router -v`.

Expected: new LLM modules do not exist.

- [ ] **Step 3: Implement request types and adapters**

```python
@dataclass(frozen=True)
class LlmRequest:
    provider_slug: str
    model: str
    api_key: str
    base_url: str
    system_prompt: str
    user_json: dict[str, object]

@dataclass(frozen=True)
class LlmResult:
    text: str
    provider_slug: str
    model: str

class ProviderFailure(RuntimeError):
    def __init__(self, provider_slug: str, category: str, retriable: bool) -> None:
        super().__init__(f"{provider_slug}: {category}")
        self.provider_slug = provider_slug
        self.category = category
        self.retriable = retriable
```

Implement payloads and response extraction for `/chat/completions`, `/responses`, `/v1/messages`, and Gemini `:generateContent`. Classify 401/403 as `auth`, 408/timeouts as `timeout`, 429 as `rate_limited`, 5xx as `unavailable`, malformed bodies as `invalid_response`. Copilot exchanges GitHub token at `https://api.github.com/copilot_internal/v2/token` before chat. Auto mode applies Hermes rules for Kimi key prefix, OpenCode model family, and Azure endpoint suffix.

Router sequence is primary plus at most five fallbacks. It decrypts one key at a time, calls transport, parses JSON into the requested Pydantic model, sends exactly one repair prompt after validation failure, marks auth failures `needs_attention`, and raises an aggregate containing only provider slug plus safe category.

- [ ] **Step 4: Run tests and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest tests.test_llm_transports tests.test_llm_router -v`.

Expected: adapter fixtures, fallback order, one repair, redaction, and auth-state tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm backend/app/core/llm_router.py backend/tests/test_llm_transports.py backend/tests/test_llm_router.py
git commit -m "feat: route LLM calls through user providers"
```

### Task 7: Publish provider and routing settings API

**Files:**
- Create: `backend/app/api/settings.py`
- Create: `backend/app/settings/service.py`
- Create: `backend/tests/test_settings_api.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing settings API tests**

```python
def test_saved_provider_response_is_masked(self) -> None:
    response = self.client.put(
        "/settings/providers/openrouter",
        headers=self.auth("valid-a"),
        json={"api_key": "sk-secret-4F2A", "model": "model-a", "base_url": None},
    )
    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.json()["masked_suffix"], "4F2A")
    self.assertNotIn("sk-secret", response.text)

def test_routing_requires_connected_provider(self) -> None:
    response = self.client.put(
        "/settings/routing", headers=self.auth("valid-a"),
        json={"primary": {"provider_slug": "openrouter", "model": "m"}, "fallbacks": [], "version": 1},
    )
    self.assertEqual(response.status_code, 422)

def test_users_cannot_see_each_others_connections(self) -> None:
    self.connect("valid-a", "openrouter", "sk-user-a")
    response = self.client.get("/settings/providers", headers=self.auth("valid-b"))
    openrouter = next(item for item in response.json()["providers"] if item["slug"] == "openrouter")
    self.assertEqual(openrouter["state"], "not_connected")

def test_model_discovery_does_not_persist_transient_key(self) -> None:
    response = self.client.post(
        "/settings/providers/openrouter/models",
        headers=self.auth("valid-a"),
        json={"api_key": "sk-transient", "base_url": None},
    )
    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.json()["models"], ["model-a", "model-b"])
    catalog = self.client.get("/settings/providers", headers=self.auth("valid-a"))
    openrouter = next(item for item in catalog.json()["providers"] if item["slug"] == "openrouter")
    self.assertEqual(openrouter["state"], "not_connected")
```

- [ ] **Step 2: Run tests and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_settings_api -v`.

Expected: settings routes return 404.

- [ ] **Step 3: Implement service and typed API**

```python
class SaveProviderRequest(BaseModel):
    api_key: Annotated[str, StringConstraints(min_length=1, max_length=4096)]
    model: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    base_url: HttpUrl | None = None

class RouteTargetModel(BaseModel):
    provider_slug: str
    model: str

class SaveRoutingRequest(BaseModel):
    primary: RouteTargetModel
    fallbacks: list[RouteTargetModel] = Field(max_length=5)
    version: int = Field(ge=1)
```

Expose GET provider catalog, POST transient connection test, POST transient model discovery, PUT test-and-save, DELETE credential, GET routing, and PUT routing. Model discovery accepts an unsaved key or uses the authenticated user's stored key, returns a sorted de-duplicated model list, and never persists transient input. Unsupported discovery returns an explicit empty list plus `manual_entry_required: true`. Delete returns `409 provider_in_use` until routing references are removed. Map version conflict to `409 settings_version_conflict`; never return upstream bodies, ciphertext, nonce, or plaintext.

- [ ] **Step 4: Run tests and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest tests.test_settings_api -v`.

Expected: settings API masking, ownership, validation, replacement, deletion, and version tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/settings.py backend/app/settings/service.py backend/app/main.py backend/tests/test_settings_api.py
git commit -m "feat: expose authenticated AI settings API"
```

### Task 8: Replace deterministic agents with typed LLM agents

**Files:**
- Create: `backend/app/llm/schemas.py`
- Create: `backend/app/llm/svg_renderer.py`
- Modify: `backend/app/agents/dna_agent.py`
- Modify: `backend/app/agents/direction_agent.py`
- Modify: `backend/app/agents/critic_agent.py`
- Modify: `backend/app/agents/content_agent.py`
- Delete: `backend/app/llm/models.py`
- Modify: `backend/tests/test_content_agent.py`
- Create: `backend/tests/test_llm_agents.py`

- [ ] **Step 1: Write failing schema and agent tests**

```python
def test_dna_agent_uses_router_output(self) -> None:
    router = QueueRouter([DnaOutput(
        beliefs=("Specific one", "Specific two", "Specific three"),
        tone_sliders=(ToneSliderOutput(label="Energy", left="Calm", right="Bold", value=61),
                      ToneSliderOutput(label="Voice", left="Formal", right="Casual", value=44)),
    )])
    dna = DnaAgent(router).hypothesize("user-a", "Acme", "A useful product brief", None, None)
    self.assertEqual(dna.beliefs[0], "Specific one")

def test_direction_agent_requires_three_distinct_directions(self) -> None:
    with self.assertRaises(ValueError):
        DirectionOutput.model_validate({"directions": [SAME_DIRECTION] * 3})

def test_renderer_escapes_llm_text_and_rejects_bad_colors(self) -> None:
    renderer = SvgRenderer()
    svg = renderer.render("</text><script>", VALID_LAYOUT_SPEC)
    self.assertNotIn("<script>", svg)
    with self.assertRaisesRegex(ValueError, "Unsupported palette color"):
        renderer.render("Acme", VALID_LAYOUT_SPEC.model_copy(update={"palette": ["red;}"]}))
```

- [ ] **Step 2: Run tests and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_llm_agents tests.test_content_agent -v`.

Expected: schemas and renderer do not exist; current agents return templates.

- [ ] **Step 3: Implement prompts, schemas, and safe rendering**

Schemas enforce exactly three beliefs, two sliders bounded 0 to 100, exactly three distinct directions, nonempty constraints, one refined direction, three rationale strings, and an `ArtifactLayoutSpec` with allowlisted layout enum, six-digit hex palette, text blocks, and CTA.

Each agent constructor accepts `StructuredLlmRouter`. Prompts use a stable role system message and serialize user inputs under a `USER_DATA_JSON` delimiter. Agent methods accept `user_id`, call router, and map validated schemas into existing domain dataclasses. Assign direction IDs 1, 2, 3 in application code and refined ID 10. Content agent requests caption, rationale, and layout spec, then calls `SvgRenderer`; it never asks model for raw SVG.

Keep XML control-character removal, entity escaping, safe hex validation, and existing SVG regression tests. Delete unused hard-coded model constants.

- [ ] **Step 4: Run tests and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest tests.test_llm_agents tests.test_content_agent -v`.

Expected: all agent schema, prompt-boundary, variation, and SVG safety tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents backend/app/llm backend/tests/test_llm_agents.py backend/tests/test_content_agent.py
git commit -m "feat: generate creative work with typed LLM agents"
```

### Task 9: Integrate authenticated LLM agents into Hermes lifecycle

**Files:**
- Modify: `backend/app/core/hermes.py`
- Modify: `backend/app/api/creative.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_hermes.py`
- Modify: `backend/tests/test_creative_api.py`

- [ ] **Step 1: Add failing lifecycle integration tests**

```python
def test_start_requires_configured_ai_route_without_mutation(self) -> None:
    hermes = build_hermes(settings=InMemorySettingsStore(), router=QueueRouter([]))
    with self.assertRaises(AiConfigurationRequired):
        hermes.start_session("user-a", "Acme", "A sufficiently detailed brief.")
    self.assertEqual(hermes.cached_session_count, 0)

def test_provider_failure_does_not_advance_rejection_state(self) -> None:
    hermes, session_id = self.started_hermes()
    self.router.raise_next(AllProvidersFailed([("openrouter", "unavailable")]))
    with self.assertRaises(AllProvidersFailed):
        hermes.handle_rejection("user-a", session_id, self.reject_two())
    self.assertEqual(hermes.get_session("user-a", session_id)["status"], "active")
```

- [ ] **Step 2: Run tests and verify RED**

Run `cd backend && .venv/bin/python -m unittest tests.test_hermes tests.test_creative_api -v`.

Expected: coordinator still constructs deterministic default agents and lacks AI configuration errors.

- [ ] **Step 3: Wire production composition without hidden fallbacks**

Remove module-level `hermes = Hermes()` construction. Build dependencies lazily from validated config: local Supabase clients, identity verifier, settings store, credential cipher, provider registry, live or test transport, router, agents, and Hermes. Unit tests inject fakes directly.

Every Hermes public method starts with `user_id`. Check routing before new LLM work. Continue copy, generate, persist, then cache-swap semantics so failed model calls or stores leave prior state retryable. Map `AiConfigurationRequired` to `409` with code `ai_configuration_required`; aggregate provider failure to `503` with safe structured attempts.

- [ ] **Step 4: Run full backend unit/API suite and verify GREEN**

Run `cd backend && .venv/bin/python -m unittest discover -s tests -v`.

Expected: all non-live tests pass; guarded local Supabase tests skip only when variables are absent.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/hermes.py backend/app/api/creative.py backend/app/main.py backend/tests
git commit -m "feat: connect authenticated workflow to user LLM routing"
```

### Task 10: Add Next.js Supabase SSR authentication

**Files:**
- Create: `client/app/lib/supabase/browser.ts`
- Create: `client/app/lib/supabase/server.ts`
- Create: `client/app/lib/supabase/proxy.ts`
- Create: `client/app/lib/auth.ts`
- Create: `client/app/components/auth/auth-provider.tsx`
- Create: `client/app/components/auth/auth-form.tsx`
- Create: `client/app/login/page.tsx`
- Create: `client/proxy.ts`
- Create: `client/e2e/helpers/session.ts`
- Create: `client/e2e/auth.spec.ts`
- Modify: `client/app/layout.tsx`
- Modify: `client/playwright.config.ts`

- [ ] **Step 1: Re-read required Next.js local guides**

Read completely before code:

```text
client/node_modules/next/dist/docs/01-app/02-guides/authentication.md
client/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
client/node_modules/next/dist/docs/01-app/02-guides/environment-variables.md
client/node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md
```

- [ ] **Step 2: Write failing auth E2E tests**

```typescript
// client/e2e/helpers/session.ts
import type { Page } from "@playwright/test"

export async function signIn(page: Page, email = "owner@example.test") {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("correct-horse-1")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL("/")
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForURL(/\/login/)
}

test("protected routes redirect to login and return after sign in", async ({ page }) => {
  await page.goto("/settings")
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings/)
  await page.getByLabel("Email").fill("owner@example.test")
  await page.getByLabel("Password").fill("correct-horse-1")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL("/settings")
})

test("invalid login keeps email and focuses password error", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("Email").fill("owner@example.test")
  await page.getByLabel("Password").fill("wrong")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect")
  await expect(page.getByLabel("Password")).toBeFocused()
})
```

- [ ] **Step 3: Run E2E and verify RED**

Run `cd client && npx playwright test e2e/auth.spec.ts`.

Expected: `/settings` is missing and `/login` is missing.

- [ ] **Step 4: Implement production and guarded test auth clients**

Use `createBrowserClient` and `createServerClient` from `@supabase/ssr` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `proxy.ts` refreshes cookies via `getUser()` and protects `/` plus `/settings`; it excludes `/login`, API, and static assets.

`AuthClient` exposes `signUp`, `signIn`, `signOut`, `getAccessToken`, and `subscribe`. Production implementation delegates to Supabase. Guarded test implementation is selected only when `NEXT_PUBLIC_AUTH_MODE=test` and `NODE_ENV !== "production"`; it uses a deterministic cookie token accepted by backend `TestIdentityVerifier`.

Auth form uses visible labels, email/password autocomplete, password reveal with accessible name, blur validation, inline errors, pending state, signup/signin mode switch, and intended-route redirect.

Playwright backend env uses `AUTH_MODE=test`, `SETTINGS_STORE_MODE=memory`, `LLM_TRANSPORT_MODE=test`, and a fixed non-secret test master key. Client env uses `NEXT_PUBLIC_AUTH_MODE=test`. Set Playwright trace to `off` so credential request bodies never enter retained traces.

- [ ] **Step 5: Run auth E2E and verify GREEN**

Run `cd client && npx playwright test e2e/auth.spec.ts`.

Expected: auth redirect, signup/signin validation, restoration, logout, and focus tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/app/lib client/app/components/auth client/app/login client/app/layout.tsx client/proxy.ts client/e2e/helpers/session.ts client/e2e/auth.spec.ts client/playwright.config.ts
git commit -m "feat: add Supabase email password login"
```

### Task 11: Build Settings with 21st components

**Files:**
- Create: `client/app/lib/api-client.ts`
- Create: `client/app/lib/settings-api.ts`
- Create: `client/app/(protected)/settings/page.tsx`
- Create: `client/app/(protected)/settings/settings-client.tsx`
- Create: `client/app/(protected)/settings/provider-row.tsx`
- Create: `client/app/(protected)/settings/routing-form.tsx`
- Create: `client/app/styles/settings.module.css`
- Create: `client/e2e/settings.spec.ts`
- Modify: `client/e2e/helpers/session.ts`
- Modify: `client/next.config.ts`

- [ ] **Step 1: Run named UI skill preflight and fetch 21st candidates**

Load `PRODUCT.md` and `DESIGN.md`. State:

```text
IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=pass shape=pass image_gate=skipped:approved Clear Workbench spec supplies component shape mutation=open
```

Use 21st MCP inspiration/builder for: accessible login form primitives, inline API-key editor, password input with reveal, provider status row, and ordered settings list. Search phrases stay concrete: `settings provider row`, `api key input`, `auth form`, `ordered fallback list`. Copy no component unchanged. Record chosen source names in implementation notes, then adapt markup to `DESIGN.md`, semantic HTML, 44-pixel targets, sentence-case labels, and existing dependencies.

- [ ] **Step 2: Write failing Settings E2E tests**

```typescript
// Add to client/e2e/helpers/session.ts
export async function connectProvider(page: Page, name: string, key: string, model: string) {
  await page.getByRole("button", { name: `Connect ${name}` }).click()
  await page.getByLabel(`${name} API key`).fill(key)
  await page.getByLabel(`${name} model`).fill(model)
  await page.getByRole("button", { name: `Test ${name} connection` }).click()
  await page.getByRole("button", { name: `Save ${name} connection` }).click()
}

export async function configuredSettings(page: Page) {
  await signIn(page)
  await page.goto("/settings")
  await connectProvider(page, "OpenRouter", "test-openrouter-4F2A", "openrouter/test-model")
  await connectProvider(page, "DeepSeek", "test-deepseek-91BC", "deepseek/test-model")
  await connectProvider(page, "Gemini", "test-gemini-7D3E", "gemini/test-model")
  await page.getByLabel("Primary provider").selectOption("openrouter")
  await page.getByLabel("Primary model").fill("openrouter/test-model")
  await page.getByRole("button", { name: "Add fallback" }).click()
  await page.getByTestId("fallback-row").nth(0).getByLabel("Provider").selectOption("deepseek")
  await page.getByTestId("fallback-row").nth(0).getByLabel("Model").fill("deepseek/test-model")
  await page.getByRole("button", { name: "Add fallback" }).click()
  await page.getByTestId("fallback-row").nth(1).getByLabel("Provider").selectOption("gemini")
  await page.getByTestId("fallback-row").nth(1).getByLabel("Model").fill("gemini/test-model")
  await page.getByRole("button", { name: "Save routing" }).click()
}

test("provider key persists across logout without redisplay", async ({ page }) => {
  await signIn(page, "owner@example.test")
  await page.goto("/settings")
  await page.getByRole("button", { name: "Connect OpenRouter" }).click()
  await page.getByLabel("OpenRouter API key").fill("test-key-4F2A")
  await page.getByLabel("OpenRouter model").fill("openrouter/test-model")
  await page.getByRole("button", { name: "Test OpenRouter connection" }).click()
  await page.getByRole("button", { name: "Save OpenRouter connection" }).click()
  await expect(page.getByText("Connected, key ending 4F2A")).toBeVisible()
  await expect(page.getByText("test-key-4F2A")).toHaveCount(0)
  await signOut(page)
  await signIn(page, "owner@example.test")
  await page.goto("/settings")
  await expect(page.getByText("Connected, key ending 4F2A")).toBeVisible()
})

test("fallback order is keyboard operable", async ({ page }) => {
  await configuredSettings(page)
  await page.getByRole("button", { name: "Move Gemini up" }).click()
  await expect(page.getByTestId("fallback-row").first()).toContainText("Gemini")
})
```

- [ ] **Step 3: Run Settings E2E and verify RED**

Run `cd client && npx playwright test e2e/settings.spec.ts`.

Expected: Settings route and controls are absent.

- [ ] **Step 4: Implement bearer API client and Settings UI**

`authorizedJson` obtains fresh access token from `AuthClient`, adds Bearer header, parses typed FastAPI errors, retries once after normal auth refresh, and redirects to login on final 401. Add Next rewrite from `/api/settings/:path*` to backend `/settings/:path*`.

Settings client loads provider catalog and routing together. Provider rows are flat list rows with explicit status words. Inline editor retains unsaved key only in React state, tests on command, enables Save after success, and revalidates on save. Disconnect uses inline confirmation. Routing form supports primary selection, manual model entry, add/remove fallback, Move up/down, maximum five, and optimistic version conflict recovery.

After a successful transient connection test, request model discovery and offer returned models in a labeled combobox. Preserve manual model entry for providers reporting `manual_entry_required` or when a valid model is absent from discovery results.

- [ ] **Step 5: Run Settings E2E and verify GREEN**

Run `cd client && npx playwright test e2e/settings.spec.ts`.

Expected: provider, routing, persistence, masking, focus, keyboard, and cross-user tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/app/lib client/app/'(protected)'/settings client/app/styles/settings.module.css client/e2e/helpers/session.ts client/e2e/settings.spec.ts client/next.config.ts
git commit -m "feat: add persistent BYOK settings"
```

### Task 12: Share protected shell and remove editorial UI patterns

**Files:**
- Create: `client/app/(protected)/layout.tsx`
- Create: `client/app/(protected)/page.tsx`
- Create: `client/app/styles/tokens.css`
- Create: `client/app/styles/shell.module.css`
- Create: `client/app/styles/forms.module.css`
- Create: `client/app/styles/workspace.module.css`
- Modify: `client/app/components/creative-shell.tsx`
- Modify: `client/app/components/workspace-context.tsx`
- Modify: `client/app/components/brief-view.tsx`
- Modify: `client/app/components/dna-view.tsx`
- Modify: `client/app/components/outputs-view.tsx`
- Modify: `client/app/lib/creative-api.ts`
- Modify: `client/app/globals.css`
- Delete: `client/app/page.tsx`
- Delete: `client/app/page.module.css`
- Modify: `client/e2e/guided-workspace.spec.ts`
- Modify: `client/e2e/helpers/session.ts`

- [ ] **Step 1: Add failing authenticated workspace and visual-rule tests**

Update every workspace helper to sign in and configure fake provider first. Add assertions:

```typescript
// Add to client/e2e/helpers/session.ts
export async function readyUser(page: Page) {
  await configuredSettings(page)
  await page.goto("/")
}

test("workspace preserves draft while visiting Settings", async ({ page }) => {
  await readyUser(page)
  await page.getByLabel("Brand name").fill("Draft Brand")
  await page.getByRole("link", { name: "Settings" }).click()
  await page.getByRole("link", { name: "Workspace" }).click()
  await expect(page.getByLabel("Brand name")).toHaveValue("Draft Brand")
})

test("Clear Workbench has no banned editorial treatments", async ({ page }) => {
  await readyUser(page)
  const audit = await page.evaluate(() => ({
    serif: getComputedStyle(document.querySelector("h1")!).fontFamily.toLowerCase().includes("serif"),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    tinyTargets: [...document.querySelectorAll("button, a")].filter((node) => node.getBoundingClientRect().height < 44).length,
  }))
  expect(audit).toEqual({ serif: false, horizontalOverflow: false, tinyTargets: 0 })
})
```

- [ ] **Step 2: Run workspace E2E and verify RED**

Run `cd client && npx playwright test e2e/guided-workspace.spec.ts`.

Expected: unauthenticated helpers redirect; Settings navigation loses provider state or draft; current serif/target assertions fail.

- [ ] **Step 3: Implement shared protected layout and design tokens**

Move `WorkspaceProvider` into protected layout so route navigation preserves drafts. Split shell from workspace view content. Settings is a labeled top-level link; Brief, DNA, and Outputs retain their shared in-page state behavior. Logout is spatially separated.

Translate `DESIGN.md` tokens into CSS custom properties using OKLCH. Remove serif variables, oversized fluid headings, texture overlay, radial decorations, gradient meter, staggered cards, glass sticky bar, colored side-stripe alert, all-caps micro-label system, and persistent card shadows. Use flat tonal layers, one-pixel borders, 8-pixel radii, sentence-case labels, overlay-only shadow, transform/opacity motion, and reduced-motion override.

`creative-api.ts` uses `authorizedJson`; `ai_configuration_required` renders direct Settings recovery. Existing strict workflow, stale-response epoch, idempotent retry, safe SVG image rendering, and mobile focus trap remain covered.

- [ ] **Step 4: Run client gates and verify GREEN**

Run from `client`:

```bash
npm run lint
npx tsc --noEmit
npm run build
npx playwright test e2e/guided-workspace.spec.ts
```

Expected: all commands exit 0 and workspace tests pass at desktop and 390-by-844 mobile viewport.

- [ ] **Step 5: Commit**

```bash
git add client/app client/e2e/guided-workspace.spec.ts
git commit -m "feat: apply Clear Workbench workspace UI"
```

### Task 13: Add guarded local Auth/BYOK integration and synchronize docs

**Files:**
- Create: `backend/tests/test_supabase_auth_settings.py`
- Modify: `supabase/config.toml`
- Modify: `README.md`
- Modify: `docs/CLIENT_FLOW.md`
- Modify: `docs/API.md`
- Modify: `docs/SUPABASE.md`
- Modify: `docs/DEVLOG.md`
- Modify: `docs/DEMO_TUTORIAL.md`
- Modify: `AGENTS.md`
- Modify: `client/AGENTS.md`
- Create: `backend/.env.example`
- Create: `client/.env.example`

- [ ] **Step 1: Write guarded local integration test**

```python
class LocalAuthSettingsIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.url = os.getenv("SUPABASE_LOCAL_TEST_URL")
        self.anon = os.getenv("SUPABASE_LOCAL_TEST_KEY")
        self.service = os.getenv("SUPABASE_LOCAL_SERVICE_ROLE_KEY")
        if not self.url or not self.anon or not self.service:
            self.skipTest("local Supabase URL, anon key, and service role key are required")
        require_local_supabase_url(self.url)

    def test_two_users_have_isolated_encrypted_settings(self) -> None:
        first = self.create_user("first")
        second = self.create_user("second")
        self.save_encrypted_provider(first.id, "openrouter", "test-secret-a")
        self.assertEqual(self.list_provider_suffixes(first.id), ["et-a"])
        self.assertEqual(self.list_provider_suffixes(second.id), [])
        raw = self.service_client.table("provider_credentials").select("ciphertext").eq("user_id", first.id).single().execute().data
        self.assertNotIn("test-secret-a", raw["ciphertext"])
```

Cleanup deletes created local users through service-role admin API. No external provider is called.

- [ ] **Step 2: Reset local database and run test RED**

Run only against proven local CLI output:

```bash
supabase db reset --local
cd backend
SUPABASE_LOCAL_TEST_URL="$API_URL" SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" SUPABASE_LOCAL_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" .venv/bin/python -m unittest tests.test_supabase_auth_settings -v
```

Expected before final store wiring: integration assertion fails; remote host guard passes before any client construction.

- [ ] **Step 3: Finish local integration wiring and authoritative docs**

Set local `auth.email.enable_confirmations = false`, retain signup, and use 8-character minimum password. Examples contain variable names and loopback URLs only:

```env
# backend/.env.example
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=replace-with-local-anon-key
SUPABASE_SERVICE_ROLE_KEY=replace-with-local-service-role-key
BYOK_MASTER_KEY=replace-with-base64-encoded-32-byte-local-key
```

```env
# client/.env.example
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace-with-local-anon-key
```

Document exact login, Settings, persistence, fallback, typed errors, local migration, rollback, master-key generation, startup, tests, no-session-recovery limit, and no-remote-operation rule in owning docs. Update root/client AGENTS pointers to `PRODUCT.md`, `DESIGN.md`, approved spec, and local Next.js docs requirement.

- [ ] **Step 4: Run local integration and docs checks GREEN**

Expected: local Auth/settings integration passes; `rg` finds no real JWT/key pattern, remote URL, stale deterministic claim, or undocumented route.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_supabase_auth_settings.py backend/.env.example client/.env.example supabase README.md docs AGENTS.md client/AGENTS.md
git commit -m "docs: document authenticated BYOK workflow"
```

### Task 14: Perform full verification and UI quality audits

**Files:**
- Modify only files required by verified audit findings.

- [ ] **Step 1: Run backend full gate**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -v
```

Expected: all unit/API tests pass; guarded local tests skip only when explicit local variables are absent.

- [ ] **Step 2: Run exact guarded local Supabase gate**

Use values from trusted `supabase status -o env`, keep values out of output and files, prove hostname is loopback, then run both Supabase integration modules. Expected: all configured local integration tests pass with zero remote connections.

- [ ] **Step 3: Run client full gate**

```bash
cd client
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```

Expected: all commands exit 0; report exact Playwright pass/fail/skip counts.

- [ ] **Step 4: Run Impeccable technical audit**

Load `PRODUCT.md`, `DESIGN.md`, and Impeccable `audit` reference. Inspect rendered `/login`, `/`, and `/settings` at 375, 768, 1024, and 1440 pixels. Score accessibility, performance, theming, responsive design, and anti-patterns 0 to 4. Record P0 to P3 findings with file/line evidence. Fix every P0/P1 finding through new RED tests, rerun affected gates, then rerun audit. Acceptance: at least 18/20 with no P0/P1 issue and explicit anti-pattern verdict `Pass`.

- [ ] **Step 5: Run UI/UX Pro Max validation**

Run focused domain search for `authentication settings API key accessibility responsive keyboard focus errors`, then verify: WCAG 2.2 AA contrast, visible focus, logical tab order, 44-pixel targets, no horizontal overflow, inline recovery, autocomplete, reduced motion, no color-only status, and one primary action per region. Fix verified failures with RED regression coverage.

- [ ] **Step 6: Verify secret and repository hygiene**

Run searches for credential prefixes, raw Authorization logging, `.env.local`, build output, Playwright traces, `dangerouslySetInnerHTML`, gradient text, serif UI variables, colored side stripes, remote Supabase commands, and untracked artifacts. Expected: no secret, generated artifact, prohibited UI pattern, or remote mutation command in implementation/docs except explicit prohibition text.

- [ ] **Step 7: Request two-stage review and commit audit fixes**

For subagent-driven execution, run spec-compliance review first and code-quality review second. Resolve findings, rerun full gates, and commit only verified fixes:

```bash
git add backend client supabase README.md AGENTS.md PRODUCT.md DESIGN.md docs
git commit -m "fix: close authenticated BYOK audit findings"
```

- [ ] **Step 8: Prepare exact handoff evidence**

Report branch, commits, changed contracts, backend test counts, local Supabase counts, Playwright counts, skips, warnings, audit score, and remaining explicitly deferred work. Do not claim success from agent reports; primary agent reruns and reads every final gate directly.
