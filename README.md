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

No environment file is needed. Sessions are lost when this backend process restarts.

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

Windows PowerShell activation: `./.venv/Scripts/Activate.ps1`.

### Client

```sh
cd client
npm install
npm run dev
```

Open <http://localhost:3000>. The client proxies `/api/creative/*` to `BACKEND_URL`, defaulting to `http://127.0.0.1:8000`. Backend health and API docs are at <http://127.0.0.1:8000/health> and <http://127.0.0.1:8000/docs>.

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
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
```

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
python -m unittest discover -s tests

cd ../client
npm run lint
npx tsc --noEmit
npm run build
npx playwright install chromium
npm run test:e2e
```

The optional live Supabase test requires local Docker-backed Supabase plus `SUPABASE_LOCAL_TEST_URL` and `SUPABASE_LOCAL_TEST_KEY`; it skips only when either variable is absent. If configured local stack is unavailable, test fails.

## Architecture

- `client/`: Next.js Guided Workspace and Playwright coverage
- `backend/`: FastAPI API and Hermes session coordinator
- `backend/app/core/hermes.py`: strict creative session lifecycle
- `backend/app/persistence/session_store.py`: in-memory default, local Supabase when local env vars are supplied
