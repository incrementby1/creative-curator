# Creative Curator

Creative Curator is a guided creative-review workspace. Start with a brief, inspect Hermes' Brand DNA hypothesis, compare three directions, reject exactly two, approve the refined survivor, and generate one final artifact.

The authenticated Guided Workspace is available at `/`. The retired `/studio` route redirects to `/`.

## Quick start

Creative Curator requires Python 3.11 or newer, Node.js 20.19.0 or newer, and a local Supabase stack for the authenticated browser workflow.

Install the backend and client dependencies:

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

cd ../client
npm install
```

Follow the [local persistence setup](docs/SUPABASE.md#local-setup) to create ignored backend and client environment files. Then start the services in separate terminals:

```sh
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --env-file .env.local
```

```sh
cd client
npm run dev
```

Open <http://localhost:3000>. Backend health and interactive API documentation are available at <http://127.0.0.1:8000/health> and <http://127.0.0.1:8000/docs>.

For a guided walkthrough, see [`docs/DEMO_TUTORIAL.md`](docs/DEMO_TUTORIAL.md).

## Local persistence

Supabase is the default persistence mode and is supported only against a local stack. It stores accounts, encrypted provider settings, routing, owner-scoped creative sessions, spatial brand graphs, independent layout/annotation versions, Blueprint snapshots, and private canvas media.

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Use values reported by the trusted local CLI in ignored `.env.local` files. Never commit credentials or run `supabase link`, `supabase db push`, linked migrations, or remote Supabase mutations without explicit approval.

For environment variables, master-key generation, isolated memory mode, migrations, integration testing, and rollback, use the authoritative [`docs/SUPABASE.md`](docs/SUPABASE.md).

Guarded graph integration additionally requires `SUPABASE_LOCAL_TEST_URL`,
`SUPABASE_LOCAL_TEST_KEY`, and `SUPABASE_LOCAL_SERVICE_ROLE_KEY`. Tests prove loopback before client
construction and skip when any variable is absent. Never substitute hosted-project values.

## Verification

Run the backend suite from `backend/` with the Python virtual environment active:

```sh
python -m unittest discover -s tests -v
```

Run all mandatory client gates from `client/`:

```sh
npm run lint
npx tsc --noEmit
npm run test:unit -- --run
npm run build
npx playwright install chromium
npm run test:e2e
```

GitHub Actions runs equivalent backend, client-quality, and client-E2E checks for pull requests targeting `main` and pushes to `main`. Tests use offline or local-only services and must never target remote Supabase or live production systems.

## Architecture

- `client/`: Next.js Guided Workspace and Playwright coverage
- `backend/`: FastAPI API and Hermes session coordinator
- `backend/app/core/hermes.py`: creative-session lifecycle
- `backend/app/composition.py`: runtime composition for persistence, settings, authentication, and LLM routing
- `backend/app/persistence/`: owner-scoped session persistence
- `backend/app/settings/`: encrypted provider settings and compatibility metadata
- `backend/app/llm/`: structured provider transports and fallback routing
- `supabase/`: local schema migrations and rollback helpers

## Documentation

- [`docs/CLIENT_FLOW.md`](docs/CLIENT_FLOW.md): product and client behavior
- [`docs/API.md`](docs/API.md): HTTP and session-state contract
- [`docs/SUPABASE.md`](docs/SUPABASE.md): local persistence workflow and safety rules
- [`docs/DEMO_TUTORIAL.md`](docs/DEMO_TUTORIAL.md): local walkthrough
- [`docs/DEVLOG.md`](docs/DEVLOG.md): concise project history
- [`docs/README.md`](docs/README.md): documentation index and ownership
