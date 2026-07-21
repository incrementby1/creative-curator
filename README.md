# Creative Curator

Creative Curator is an early direction-studio prototype. A user submits a brand
and creative goal, compares three campaign territories, requests a revised round,
and approves a direction for production.

## Documentation

- `docs/DEVLOG.md`: narrative development log and next-step notes
- `docs/API.md`: backend endpoint contract
- `docs/CLIENT_FLOW.md`: single-page UI flow
- `docs/SUPABASE.md`: optional persistence setup and security notes
- `docs/DEMO_TUTORIAL.md`: step-by-step demo script

## Run locally

The project uses two terminals. The backend runs in memory by default and does
not need `.env.local`.

```powershell
cd backend
python3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

uvicorn app.main:app --reload
```

### Optional local Supabase persistence

From the repository root, start and reset the local stack, then use the local
values reported by `supabase status -o env` to create ignored
`backend/.env.local` (see `backend/.env.example`):

```sh
supabase start
supabase db reset --local
supabase status -o env
```

After creating that file, start the backend from `backend/` with:

```sh
uvicorn app.main:app --reload --env-file .env.local
```

```powershell
cd client
npm install
npm run dev
```

Open `http://localhost:3000`. The API documentation is available at
`http://localhost:8000/docs`, and `GET /health` can be used for service checks.
The client proxies `/api/creative/*` to `BACKEND_URL` (default:
`http://127.0.0.1:8000`).

## Verify

```powershell
cd backend
python -m unittest discover -s tests

cd ..\client
npm run lint
npm run build
```

## Current architecture

- `client/`: Next.js 16 App Router UI
- `backend/`: FastAPI JSON API
- `backend/app/core/hermes.py`: session-based workflow coordinator
- `backend/app/persistence/session_store.py`: in-memory store by default; optional
  Supabase-backed persistence when `SUPABASE_URL` + `SUPABASE_*_KEY` are set

Sessions run in-memory by default and are lost whenever the API process restarts.
If you configure local Supabase env vars, sessions are persisted in the
`creative_sessions` table.
