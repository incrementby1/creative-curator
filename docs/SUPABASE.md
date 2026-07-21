# Supabase persistence

Supabase is integrated as an **optional local-only** session persistence layer.

- If env vars are not set, the backend runs **in-memory** (sessions reset on restart).
- If local Supabase env vars are set, sessions are stored in Postgres in `public.creative_sessions`.

## Configuration

Start and reset the local instance only:

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Use the local values to create an ignored `backend/.env.local` with:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (recommended for backend servers)
  - or `SUPABASE_ANON_KEY` (works for demos, but then RLS/policies must allow access)

Start the backend from `backend/` and explicitly load that ignored file:

```sh
cd backend
uvicorn app.main:app --reload --env-file .env.local
```

The backend auto-detects these in:

- `backend/app/persistence/session_store.py` (`get_default_session_store()`)

Never use `supabase link`, `supabase db push`, linked migrations, or a remote
Supabase mutation without explicit user approval. Persistence tests use
`SUPABASE_LOCAL_TEST_URL` and `SUPABASE_LOCAL_TEST_KEY`, and reject targets
other than `localhost` or `127.0.0.1`.

## Schema

Migration applied in this session: `create_creative_sessions`.

Table: `public.creative_sessions`

Columns:
- `id uuid primary key`
- `brand_name text`
- `description text`
- `goal text null`
- `status text` (active/refined_ready/approved/executed)
- `state jsonb` (full serialized session)
- `created_at timestamptz`
- `updated_at timestamptz` (maintained by trigger)

## Security note (important)

For hackathon speed, the migration creates an RLS policy that effectively allows all access:

```sql
create policy creative_sessions_public_all
on public.creative_sessions
for all
using (true)
with check (true);
```

That is **not production-safe**.

If you want, next step is to:
- add Supabase Auth
- store `owner_user_id`
- restrict policies to `auth.uid()`

## How the backend uses Supabase

Implementation: `SupabaseSessionStore`

- `create(session_id, state)` inserts a row with `id=session_id` and `state=jsonb`.
- `get(session_id)` selects `state`.
- `save(session_id, state)` updates the row.

If Supabase is configured but the python `supabase` package is missing, the store falls back to in-memory for demo reliability.
