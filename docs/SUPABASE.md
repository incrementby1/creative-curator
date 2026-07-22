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
SUPABASE_ANON_KEY=<local-anon-key>
SETTINGS_STORE_MODE=memory
BYOK_MASTER_KEY=<base64-encoded-32-byte-local-key>
```

The anon key is required for verifying end-user bearer tokens. A local service-role key may additionally be configured for backend-only persistence, but it is never used to verify end-user identity. From `backend/`, start with:

```sh
uvicorn app.main:app --reload --env-file .env.local
```

Creative routes require a Supabase user access token in `Authorization: Bearer <access-token>`. The backend asks local Supabase for that user and uses the verified user id as session owner. Missing local URL/anon-key configuration fails closed when a protected route is requested; `/health` remains available because verifier construction is lazy.

For isolated backend development without Supabase, set `AUTH_MODE=test`, `SETTINGS_STORE_MODE=memory`, and a non-production `APP_ENV`, then send a non-empty `test-user:<id>` bearer token. Test auth is rejected in production.

Never run `supabase link`, `supabase db push`, linked migrations, or any remote Supabase mutation without explicit user approval. Persistence testing may target only `localhost` or `127.0.0.1`.

## Schema and rollback

`supabase/migrations/20260718100737_create_creative_sessions.sql` creates local `public.creative_sessions`, update timestamp trigger, RLS enablement, and demo policy. `20260722090000_add_auth_and_byok_settings.sql` destructively truncates demo sessions, adds their required `auth.users` owner and owner index, and creates RLS-enabled `provider_credentials` and `user_ai_settings` tables. It creates no permissive credential/settings policies. `supabase db reset --local` applies both migrations to the local stack.

Rollback is manual: `supabase/manual/rollback_auth_and_byok_settings.sql` drops AI settings, credentials, the session owner index, then the session owner column. `rollback_creative_sessions.sql` removes the original session schema. These helpers are deliberately outside migration history; reset reapplies migrations rather than rolling them back.

## Runtime behavior

`get_default_session_store()` selects Supabase only when `SUPABASE_URL` plus service-role or anon key exist. It falls back to in-memory only if Supabase store construction/configuration initialization fails. Authentication independently requires the anon key; a service-role key is not an end-user verifier. Create, get, and save operation failures propagate to caller. Every operation includes `user_id`; in-memory keys and Hermes cache keys are `(user_id, session_id)`, while Supabase reads and updates filter both columns. Hermes rejects mismatched embedded owners/session ids before deserialization, caching, or persistence.

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

## User AI settings and credential vault

`BYOK_MASTER_KEY` is a base64-encoded 32-byte AES key for local development. Keep it only in ignored `backend/.env.local`; never commit or reuse it outside the local environment. The current credential cipher accepts the decoded 32 bytes and uses AES-256-GCM with a new 96-bit nonce for each encryption. User id, provider slug, and key version are authenticated with the ciphertext, so an encrypted value cannot be moved to another owner or provider.

Only ciphertext, nonce, key version, and a display suffix are persisted in `provider_credentials`; plaintext exists only inside the encrypt/decrypt method call. Keys longer than four characters expose their final four characters for display. Keys of four characters or fewer expose an empty suffix so the full secret is never displayed. Application logs can recursively redact known credential fields, including ciphertext and nonce.

Credential records and AI routing settings have owner-scoped in-memory and injected-client Supabase stores. In-memory operations share a reentrant lock so routing and credential-state compare-and-swap operations are atomic. Authentication/decryption attention marking compares the exact owner, provider, ciphertext, nonce, and key version that routing used, then updates only `connection_state` and `updated_at`; a concurrently replaced credential is never overwritten. Supabase zero-row updates return false, and store failures remain generic. Routing requires a primary provider and model together; fallback targets are validated and normalized to an immutable tuple. Writes use optimistic version checks, so stale updates and first-write races fail with a version conflict. Credential upserts and routing inserts/updates explicitly refresh UTC `updated_at` without replacing `created_at`. No settings HTTP routes or client UI exist yet, and no real Supabase operation is required by unit tests.

## Security status

The original `creative_sessions` RLS policy still allows all reads and writes for the local demo, so direct database access is not production-safe even though authenticated application queries are owner-scoped. Credential and AI-setting tables have RLS enabled without permissive anonymous policies. Credential encryption and owner-scoped store adapters are implemented, but restrictive session/settings policies, runtime provider access, API/UI integration, client login/token forwarding, and any remote deployment remain deferred.
