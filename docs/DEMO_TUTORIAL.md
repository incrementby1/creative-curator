# Demo tutorial (developer walkthrough)

This is a step-by-step guide to run a **mock demonstration** of the Creative Curator MVP:

**Intake → Brand DNA → 3 Directions → Reject 2 → Refined Direction → Final Content (caption + layout mock + rationale)**

---

## 0) Prerequisites

- Node.js (for the client)
- Python 3.11+ (for the backend)
- (Optional) Supabase CLI if you want to apply migrations from your terminal

---

## 1) Pick your persistence mode

### Option A — In-memory (fastest)

Do nothing. Sessions will reset whenever the backend restarts.

### Option B — Local Supabase persistence (recommended for a demo)

From the repository root, start and reset the local instance:

```sh
supabase start
supabase db reset --local
supabase status -o env
```

The reset applies `supabase/migrations/20260718100737_create_creative_sessions.sql`
to the local instance. No remote project, dashboard, or database password is
needed for this demo.

---

## 2) Configure backend env vars

Use the reported local API URL and key to create ignored `backend/.env.local`:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<local service-role key>
```

Do not link to or configure a remote Supabase project for this demo.

---

## 3) Start the backend

Open Terminal A:

```powershell
cd backend
python3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

For Option A (in-memory), no environment file is needed:

```powershell
uvicorn app.main:app --reload
```

For Option B (local Supabase), first complete step 2 and then load
`backend/.env.local` explicitly:

```powershell
uvicorn app.main:app --reload --env-file .env.local
```

Sanity check:
- Open `http://127.0.0.1:8000/health` → should return `{ "status": "ok" }`
- Open `http://127.0.0.1:8000/docs` → interactive API docs

---

## 4) Start the client

Open Terminal B:

```powershell
cd client
npm install
npm run dev
```

Open:
- `http://localhost:3000`

The client proxies `/api/creative/*` to the backend using `BACKEND_URL` (see `client/next.config.ts`).

If needed, create `client/.env.local`:

```env
BACKEND_URL=http://127.0.0.1:8000
```

---

## 5) Demo script (what to click)

1. **Intake**
   - Brand name: `Northstar Coffee`
   - Description: `Neighborhood coffee shop with a small seasonal menu.`
   - Reference (optional): `Warm but confident — not meme-y`
   - Goal (optional): `Get more Google Maps actions (calls + direction taps)`
   - Click **Generate directions**

2. **Brand DNA hypothesis**
   - Read the 3 beliefs and the two tone sliders.
   - Say out loud: “This is the system’s *first guess* — you correct it by rejecting directions.”

3. **Directions**
   - Review the three cards.
   - Select **exactly 2** to reject.
   - For each rejected direction, pick one reason:
     - Too generic
     - Too loud
     - Not our audience
     - Not authentic
     - Other
   - Add an optional note.
   - Submit rejection.

4. **Refined direction**
   - The refined direction should explicitly reflect rejection constraints (look at `why_it_works` and the displayed constraints chips).

5. **Approve + Execute**
   - Click the approve/execute CTA.
   - Show:
     - the final caption
     - the SVG layout mock
     - the 3-bullet rationale, especially “what we avoided due to rejection.”

---

## 6) Where the “creative service is unavailable” error comes from

Source:
- `client/app/page.tsx` (the fetch helper)

The UI throws that message when:
- the request fails (backend not reachable), OR
- backend returns non-2xx, AND
- the response body isn’t JSON with a `detail` field.

Common fixes:
- ensure the backend is running
- ensure `BACKEND_URL` points to it
- check backend logs for exceptions (often caused by Supabase misconfig or missing env loading)

---

## 7) Are “AI agents” being used? If so, where?

Yes — the backend uses *agent modules* (deterministic, LLM-ready later).

Orchestration:
- `backend/app/core/hermes.py`
  - constructs and calls:
    - `DnaAgent` (`backend/app/agents/dna_agent.py`) — Brand DNA hypothesis
    - `DirectionAgent` (`backend/app/agents/direction_agent.py`) — 3 divergent directions + refinement
    - `CriticAgent` (`backend/app/agents/critic_agent.py`) — converts rejection labels into constraints
    - `ContentAgent` (`backend/app/agents/content_agent.py`) — caption + SVG layout mock + rationale

Important clarification:
- These “agents” are **internal components**. They do **not** currently call an external LLM.
- There is an unused OpenAI helper (`backend/app/core/llm_router.py`) left in the repo, but the MVP flow implemented here is deterministic for demo reliability.
