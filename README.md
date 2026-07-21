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

`BYOK_MASTER_KEY` represents exactly 32 decoded bytes and belongs only in ignored local environment files. Credential-vault code encrypts provider keys with AES-256-GCM and persists ciphertext, nonce, key version, and a masked suffix—never plaintext. Credential and routing API routes and client UI are not wired yet.

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
