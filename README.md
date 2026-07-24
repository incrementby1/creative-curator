# Creative Curator

Creative Curator is a guided creative-review workspace. Start with a brief, inspect Hermes' Brand DNA hypothesis, compare three directions, reject exactly two, approve the refined survivor, and generate one final artifact.

The root route (`/`) is the Guided Workspace. The retired `/studio` route redirects to `/`.

## Documentation

- [`docs/CLIENT_FLOW.md`](docs/CLIENT_FLOW.md): product and client behavior
- [`docs/API.md`](docs/API.md): HTTP and session-state contract
- [`docs/SUPABASE.md`](docs/SUPABASE.md): local-only persistence workflow
- [`docs/DEMO_TUTORIAL.md`](docs/DEMO_TUTORIAL.md): local walkthrough
- [`docs/DEVLOG.md`](docs/DEVLOG.md): project history

## Run locally

Requires Python 3.11+ and Node.js 20.9.0 or newer. Use two terminals.

### Backend — explicit isolated memory mode

Sessions are lost when this backend process restarts. Use guarded test authentication for this isolated mode:

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
APP_ENV=test \
AUTH_MODE=test \
SETTINGS_STORE_MODE=memory \
LLM_TRANSPORT_MODE=test \
BYOK_MASTER_KEY=a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s= \
uvicorn app.main:app --reload
```

Windows PowerShell activation: `./.venv/Scripts/Activate.ps1`.

### Client

```sh
cd client
npm install
npm run dev
```

Open <http://localhost:3000>. The client proxies `/api/creative/*` and `/api/settings/*` to `BACKEND_URL`, defaulting to `http://127.0.0.1:8000`. Backend health and API docs are at <http://127.0.0.1:8000/health> and <http://127.0.0.1:8000/docs>.

Backend creative routes require a verified bearer token. Client provides Supabase email/password login, refresh-safe cookie sessions, a shared Clear Workbench shell for protected Workspace and Settings routes, and one authorized JSON path for creative and settings requests. Client-side navigation to Settings preserves unsaved workspace drafts; refresh still clears React-only creative state. Missing AI routing offers direct Settings recovery. Settings supports masked BYOK provider connection, transient testing, model discovery with manual entry, disconnect confirmation, and versioned primary/fallback routing. Playwright authenticates through its guarded deterministic helper with `Authorization: Bearer test-user:<id>`; test auth is forbidden in production. Saved creative-session recovery remains pending.

### Local authenticated persistence

Supabase mode is default and local-only. It persists accounts, encrypted provider settings, routing, and backend creative sessions. From repository root:

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Copy `backend/.env.example` to ignored `backend/.env.local`, replace key placeholders from trusted `supabase status -o env`, and generate a local master key:

```sh
python -c 'import base64, secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())'
```

Use live provider calls for the browser workflow:

```env
APP_ENV=development
AUTH_MODE=supabase
SETTINGS_STORE_MODE=supabase
LLM_TRANSPORT_MODE=live
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
BYOK_MASTER_KEY=<base64-encoded-32-byte-local-key>
```

Copy `client/.env.example` to ignored `client/.env.local` and replace its anon-key placeholder with same local anon key. Local Auth allows signup, auto-confirms email, and requires passwords of at least eight characters. Creative API callers send their local Supabase access token as `Authorization: Bearer <access-token>`. Backend verifies it with anon key and uses verified user id for every operation. Local service-role key is required for persistence, but never verifies end users. Missing, remote, or incomplete configuration fails closed; `/health` remains public.

`BYOK_MASTER_KEY` represents exactly 32 decoded bytes and belongs only in ignored local environment files. It is required for both memory and Supabase settings modes. Credential-vault code encrypts provider keys with AES-256-GCM and persists ciphertext, nonce, key version, and masked suffix—never plaintext. Authenticated credential/routing API routes and protected client Settings UI are wired.

Supported API-key provider metadata is a static compatibility snapshot of official Hermes Agent repository at commit `8208fc52701332f213e6c51ebc0b610be00300de`. Validated manifest records credential aliases, endpoint override names, transports, model-discovery capabilities, and provider-specific dispatch rules; it contains no credential values. Authenticated `/settings` endpoints publish catalog, test transient or stored credentials, discover models, test-and-save encrypted credentials, disconnect providers, and manage versioned primary/fallback routing. The authenticated creative lifecycle now uses the same owner-scoped settings store and structured router for DNA, direction, critique, refinement, and final-content generation. Internal structured routing dispatches through chat, Responses, Anthropic, Gemini, and Copilot adapters, with one same-provider JSON repair and ordered configured fallbacks. Each request resolves hostname exactly once, rejects any non-global answer, and connects through numeric pinned-IP URL while preserving original `Host` authority and TLS hostname verification through HTTPX/httpcore's `sni_hostname` request extension. Owned clients ignore environment proxies and disable connection reuse. Responses stream into bounded buffer, reject oversized `Content-Length`, and never follow redirects. Provider bodies, keys, validation inputs, ciphertext, nonce, and raw exceptions are excluded from HTTP failures. One lazy composition shares one owned live dispatcher across settings and creative routing and closes it once at shutdown. Missing creative routing returns safe `409`; exhausted providers return safe structured `503`. Client renders catalog in manifest order and never stores or redisplays submitted keys. Snapshot excludes local no-key providers, OAuth/device-code providers, AWS SDK credential chains, and external-process providers. Updating compatibility requires review against new immutable official Hermes commit plus manifest, tests, and docs.

Client E2E composition must set `APP_ENV=test`, `LLM_TRANSPORT_MODE=test`, auth/store test modes, and a local master key. Guarded mode accepts only bounded keys matching `test-`, one ASCII letter or digit, then up to 127 ASCII letters, digits, `.`, `_`, or `-`, including approved provider fixtures such as `test-openrouter-4F2A`. Discovery returns `<provider-slug>-test-model`; creative generation returns deterministic schema-valid outputs. Neither path creates HTTPX or makes an outbound request. Other keys fail authentication. Production rejects test transport mode before provider or HTTP construction.

Run offline backend composition directly from `backend/`:

```sh
APP_ENV=test \
AUTH_MODE=test \
SETTINGS_STORE_MODE=memory \
LLM_TRANSPORT_MODE=test \
BYOK_MASTER_KEY=a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s= \
uvicorn app.main:app --reload
```

Authenticate requests with `Bearer test-user:<id>` and use a bounded `test-...` provider key. This command uses memory only and makes no Supabase or provider request.

Pinned-IP TLS security depends on the reviewed HTTPX `0.28.1` → httpcore `1.0.9` extension boundary, so both packages are exact requirements. Any upgrade requires deliberate source review confirming that HTTPX still forwards request extensions and httpcore still uses `sni_hostname` as TLS `server_hostname`, plus the full transport regression suite. Arbitrary HTTP clients are not a production constructor option; unit fakes require the explicit `test_client` and `allow_test_client=True` test-only capability.

Then start backend and client in separate terminals:

```sh
cd backend
uvicorn app.main:app --reload --env-file .env.local

cd ../client
npm run dev
```

Never run `supabase link`, `supabase db push`, linked migrations, or any remote Supabase mutation without explicit approval.

For the Next.js login, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the same local Supabase project used by the backend, then run `npm run dev` from `client/`. These public values are embedded at build time. Do not enable `NEXT_PUBLIC_AUTH_MODE=test` outside the Playwright harness; production builds ignore that mode and use Supabase authentication. Playwright supplies deterministic memory/test backend modes, an offline transport, empty Supabase values, and a guarded cookie identity automatically.

## Verify

After activating project virtual environment, run:

```sh
cd backend
python -m unittest discover -s tests -v

cd ../client
npm run lint
npx tsc --noEmit
npm run build
npx playwright install chromium
npm run test:e2e
```

GitHub Actions runs the same mandatory gates for every pull request targeting `main` and every push to `main`. `.github/workflows/ci.yml` exposes separate backend, client-quality, and client-E2E checks. CI uses Python 3.11, Node.js 22, an offline in-memory FastAPI composition for Playwright, and no repository secrets or remote Supabase operations.

Guarded integration requires local Docker-backed Supabase and trusted values from `supabase status -o env`. Tests skip when required variables are absent and fail when configured local service is unavailable. They prove loopback hostname before client construction, create and remove disposable local users, verify eight-character Auth policy and encrypted two-user settings isolation, and make no provider request. Keep keys only in current shell:

```sh
eval "$(supabase status -o env)"
cd backend
SUPABASE_LOCAL_TEST_URL="$API_URL" \
SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" \
SUPABASE_LOCAL_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
python -m unittest tests.test_supabase_auth_settings -v
```

Browser creative state remains React-only: client navigation preserves it, but refresh/login recovery is not implemented. Accounts and owner-scoped AI settings do persist locally. Never run `supabase link`, `supabase db push`, linked migrations, or any remote mutation without explicit approval.

## Architecture

- `client/`: Next.js Guided Workspace and Playwright coverage
- `backend/`: FastAPI API and Hermes session coordinator
- `backend/app/core/hermes.py`: strict creative session lifecycle
- `backend/app/composition.py`: explicit memory or local-Supabase settings/session composition and shared LLM runtime
- `backend/app/persistence/session_store.py`: owner-scoped in-memory and local-Supabase session-store implementations
- `backend/app/settings/provider_manifest.json`: pinned, API-key-only Hermes provider compatibility metadata
- `backend/app/llm/`: secret-safe provider transports and owner-scoped structured fallback router
