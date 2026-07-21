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
CREATIVE_DEMO_USER_ID=<existing-local-auth-user-uuid>
```

`SUPABASE_ANON_KEY` is also supported. From `backend/`, start with:

```sh
uvicorn app.main:app --reload --env-file .env.local
```

The transitional `CREATIVE_DEMO_USER_ID` must be a valid UUID already present in local `auth.users`. Missing or malformed values return `503` before any session insert. The backend does not create or query auth users for this bridge; Task 3 removes it when verified request identity is available. Memory-only mode uses a deterministic internal UUID and needs no extra environment value.

Never run `supabase link`, `supabase db push`, linked migrations, or any remote Supabase mutation without explicit user approval. Persistence testing may target only `localhost` or `127.0.0.1`.

## Schema and rollback

`supabase/migrations/20260718100737_create_creative_sessions.sql` creates local `public.creative_sessions`, update timestamp trigger, RLS enablement, and demo policy. `20260722090000_add_auth_and_byok_settings.sql` destructively truncates demo sessions, adds their required `auth.users` owner and owner index, and creates RLS-enabled `provider_credentials` and `user_ai_settings` tables. It creates no permissive credential/settings policies. `supabase db reset --local` applies both migrations to the local stack.

Rollback is manual: `supabase/manual/rollback_auth_and_byok_settings.sql` drops AI settings, credentials, the session owner index, then the session owner column. `rollback_creative_sessions.sql` removes the original session schema. These helpers are deliberately outside migration history; reset reapplies migrations rather than rolling them back.

## Runtime behavior

`get_default_session_store()` selects Supabase only when `SUPABASE_URL` plus service-role or anon key exist. It falls back to in-memory only if Supabase store construction/configuration initialization fails. Create, get, and save operation failures propagate to caller. Every operation includes `user_id`; in-memory keys and Hermes cache keys are `(user_id, session_id)`, while Supabase reads and updates filter both columns. Hermes rejects mismatched embedded owners/session ids before deserialization, caching, or persistence.

Local live integration uses `SUPABASE_LOCAL_TEST_URL`, `SUPABASE_LOCAL_TEST_KEY`, and `SUPABASE_LOCAL_TEST_USER_ID`, where the last value is an existing user UUID in the reset local stack. It skips when required environment is absent. With all values configured, an offline Docker/local stack fails rather than skipping.

Evaluate only environment output from trusted local CLI. Keep local values in current shell and run guarded integration without printing or placing key value in docs or tracked files:

```sh
eval "$(supabase status -o env)"
cd backend
SUPABASE_LOCAL_TEST_URL="$API_URL" \
SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" \
SUPABASE_LOCAL_TEST_USER_ID="<existing-local-auth-user-uuid>" \
python -m unittest tests.test_supabase_store -v
```

Test guard rejects every hostname except `localhost` and `127.0.0.1` before client construction.

## Security status

The original `creative_sessions` RLS policy still allows all reads and writes for the local demo, so direct database access is not production-safe even though application queries are owner-scoped. Credential and AI-setting tables have RLS enabled without permissive anonymous policies. Request authentication, restrictive session policies, credential encryption/runtime access, and any remote deployment remain deferred.
