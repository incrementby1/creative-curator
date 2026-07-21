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

The project uses two terminals.

```powershell
cd backend
python3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

# Optional local persistence (recommended for demos):
# from the repository root, run `supabase start`, `supabase db reset --local`,
# and `supabase status -o env`; put the local values in ignored `.env.local`.

# Run this from backend/ so --env-file resolves to backend/.env.local.
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
