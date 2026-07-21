# Local Supabase persistence

Supabase is optional, local-only persistence for creative sessions. Without local environment values, backend uses in-memory store and sessions disappear on backend restart.

## Local setup

From repository root:

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Create ignored `backend/.env.local` from reported local values:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
```

`SUPABASE_ANON_KEY` is also supported. From `backend/`, start with:

```sh
uvicorn app.main:app --reload --env-file .env.local
```

Never run `supabase link`, `supabase db push`, linked migrations, or any remote Supabase mutation without explicit user approval. Persistence testing may target only `localhost` or `127.0.0.1`.

## Schema and rollback

`supabase/migrations/20260718100737_create_creative_sessions.sql` creates local `public.creative_sessions`, update timestamp trigger, RLS enablement, and demo policy. `supabase db reset --local` applies migration to local stack.

Rollback is manual: when working against local instance and removal is intended, run SQL in `supabase/manual/rollback_creative_sessions.sql` through local tooling. The rollback is deliberately outside migration history; reset creates table and does not automatically remove it.

## Runtime behavior

`get_default_session_store()` selects Supabase only when `SUPABASE_URL` plus service-role or anon key exist. It falls back to in-memory only if Supabase store construction/configuration initialization fails. Create, get, and save operation failures propagate to caller. Local live integration test uses `SUPABASE_LOCAL_TEST_URL` and `SUPABASE_LOCAL_TEST_KEY`; it skips only when either env variable is absent. With both configured, an offline Docker/local stack fails test rather than skipping.

Evaluate only environment output from trusted local CLI. Keep local values in current shell and run guarded integration without printing or placing key value in docs or tracked files:

```sh
eval "$(supabase status -o env)"
cd backend
SUPABASE_LOCAL_TEST_URL="$API_URL" \
SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" \
python -m unittest tests.test_supabase_store -v
```

Test guard rejects every hostname except `localhost` and `127.0.0.1` before client construction.

## Security status

Current migration's RLS policy allows all reads and writes. This is intentionally permissive for local demo and is not production-safe. Remote deployment, authentication, ownership columns, and restrictive RLS are deferred work.
