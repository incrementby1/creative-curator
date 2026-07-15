# Creative Curator

Creative Curator is an early direction-studio prototype. A user submits a brand
and creative goal, compares three campaign territories, requests a revised round,
and approves a direction for production.

## Run locally

The project uses two terminals.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
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
- `backend/app/core/hermes.py`: provider-independent workflow contract and
  temporary in-memory session store

Sessions are intentionally ephemeral in this first slice and are lost whenever
the API process restarts. Persistence, authentication, and a model-backed
direction generator should be added before production use.
