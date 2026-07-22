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

### Backend — in-memory default

Sessions are lost when this backend process restarts. Use guarded test authentication for this isolated mode:

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
APP_ENV=development AUTH_MODE=test SETTINGS_STORE_MODE=memory uvicorn app.main:app --reload
```

Windows PowerShell activation: `./.venv/Scripts/Activate.ps1`.

### Client

```sh
cd client
npm install
npm run dev
```

Open <http://localhost:3000>. The client proxies `/api/creative/*` to `BACKEND_URL`, defaulting to `http://127.0.0.1:8000`. Backend health and API docs are at <http://127.0.0.1:8000/health> and <http://127.0.0.1:8000/docs>.

Backend creative routes now require a verified bearer token. Client login and token forwarding are pending, so the current Guided Workspace cannot yet complete its API flow and its existing E2E flow remains unauthenticated until that hookup lands. Direct test-mode requests may use `Authorization: Bearer test-user:<id>`; test auth is forbidden in production.

### Optional local Supabase persistence

Supabase is optional and local only. From repository root:

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Copy local values from that output into ignored `backend/.env.local`, for example:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local-anon-key>
SETTINGS_STORE_MODE=memory
BYOK_MASTER_KEY=<base64-encoded-32-byte-local-key>
```

Creative API callers send their local Supabase access token as `Authorization: Bearer <access-token>`. The backend verifies it with the anon key and uses the verified user id for every session operation. A service-role key may additionally be configured for backend persistence, but is never used for end-user verification. Missing auth configuration fails closed on protected routes while `/health` remains public.

`BYOK_MASTER_KEY` represents exactly 32 decoded bytes and belongs only in ignored local environment files. It is required for both memory and Supabase settings modes. Credential-vault code encrypts provider keys with AES-256-GCM and persists ciphertext, nonce, key version, and masked suffix—never plaintext. Authenticated credential/routing API routes are wired; client UI is not yet wired.

Supported API-key provider metadata is a static compatibility snapshot of official Hermes Agent repository at commit `8208fc52701332f213e6c51ebc0b610be00300de`. Validated manifest records credential aliases, endpoint override names, transports, model-discovery capabilities, and provider-specific dispatch rules; it contains no credential values. Authenticated `/settings` endpoints publish catalog, test transient or stored credentials, discover models, test-and-save encrypted credentials, disconnect providers, and manage versioned primary/fallback routing. Internal structured routing dispatches through chat, Responses, Anthropic, Gemini, and Copilot adapters, with one same-provider JSON repair and ordered configured fallbacks. Each request resolves hostname exactly once, rejects any non-global answer, and connects through numeric pinned-IP URL while preserving original `Host` authority and TLS hostname verification through HTTPX/httpcore's `sni_hostname` request extension. Owned clients ignore environment proxies and disable connection reuse. Responses stream into bounded buffer, reject oversized `Content-Length`, and never follow redirects. Provider bodies, keys, validation inputs, ciphertext, nonce, and raw exceptions are excluded from HTTP failures. Application shutdown closes owned dispatcher. Client settings UI remains unwired, and creative agents remain deterministic, so only explicit backend settings test/discovery requests make live provider calls. Snapshot excludes local no-key providers, OAuth/device-code providers, AWS SDK credential chains, and external-process providers. Updating compatibility requires review against new immutable official Hermes commit plus manifest, tests, and docs.

Future client E2E composition must set `APP_ENV=test`, `LLM_TRANSPORT_MODE=test`, auth/store test modes, and local master key; current client E2E process configuration does not wire this yet. Guarded mode accepts only bounded keys matching `test-`, one ASCII letter or digit, then up to 127 ASCII letters, digits, `.`, `_`, or `-`, including approved provider fixtures such as `test-openrouter-4F2A`. Discovery returns `<provider-slug>-test-model` without creating HTTPX. Other keys fail authentication. Production rejects test transport mode before provider or HTTP construction.

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

Then start backend from `backend/`:

```sh
cd backend
uvicorn app.main:app --reload --env-file .env.local
```

Never run `supabase link`, `supabase db push`, linked migrations, or any remote Supabase mutation without explicit approval.

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

The optional live Supabase test requires local Docker-backed Supabase, local values from `supabase status -o env`, and an existing user UUID from the reset local stack. It skips when required environment is absent. If fully configured local stack is unavailable, test fails. Evaluate only output from trusted local CLI, keep key in current shell, and run without printing or writing key value:

```sh
eval "$(supabase status -o env)"
cd backend
SUPABASE_LOCAL_TEST_URL="$API_URL" \
SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" \
SUPABASE_LOCAL_TEST_USER_ID="<existing-local-auth-user-uuid>" \
python -m unittest tests.test_supabase_store -v
```

## Architecture

- `client/`: Next.js Guided Workspace and Playwright coverage
- `backend/`: FastAPI API and Hermes session coordinator
- `backend/app/core/hermes.py`: strict creative session lifecycle
- `backend/app/persistence/session_store.py`: in-memory default, local Supabase when local env vars are supplied
- `backend/app/settings/provider_manifest.json`: pinned, API-key-only Hermes provider compatibility metadata
- `backend/app/llm/`: secret-safe provider transports and owner-scoped structured fallback router
