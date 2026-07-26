# Local Supabase persistence

Supabase is the strict default persistence mode and is supported only against a local stack. `RuntimeConfig` defaults `SETTINGS_STORE_MODE` to `supabase`; missing, remote, or incomplete Supabase configuration fails closed. Isolated development must explicitly select `SETTINGS_STORE_MODE=memory`, in which case both AI settings and creative sessions are process-local and disappear on restart.

## Local setup

From repository root:

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Create ignored `backend/.env.local` from `backend/.env.example`, generate a fresh local-only master key, and replace placeholders with trusted status values:

```sh
python -c 'import base64, secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())'
```

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
SETTINGS_STORE_MODE=supabase
LLM_TRANSPORT_MODE=live
BYOK_MASTER_KEY=<generated-base64-value>
```

Create ignored `client/.env.local` from `client/.env.example`. Keep `NEXT_PUBLIC_SUPABASE_URL` on the same local stack and replace `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the same local anon key used by the backend. `BACKEND_URL` defaults to the loopback FastAPI service shown in the example.

Anon key verifies end-user bearer tokens. Service-role key is server-only and persists owner-scoped settings/sessions; it never verifies end-user identity. Local Auth keeps email signup enabled, auto-confirms email, and rejects passwords shorter than eight characters. From `backend/`, start with:

```sh
uvicorn app.main:app --reload --env-file .env.local
```

Creative routes require a Supabase user access token in `Authorization: Bearer <access-token>`. The backend asks local Supabase for that user and uses the verified user id as session owner. Missing local URL/anon-key configuration fails closed when a protected route is requested; `/health` remains available because verifier construction is lazy.

For isolated backend development without Supabase, explicitly set `APP_ENV=test`, `AUTH_MODE=test`, `SETTINGS_STORE_MODE=memory`, `LLM_TRANSPORT_MODE=test`, and a valid base64-encoded 32-byte `BYOK_MASTER_KEY`, then send a non-empty `test-user:<id>` bearer token. Test auth and test LLM transport are rejected in production.

Never run `supabase link`, `supabase db push`, linked migrations, or any remote Supabase mutation without explicit user approval. Persistence testing may target only `localhost` or `127.0.0.1`.

## Schema and rollback

`supabase/migrations/20260718100737_create_creative_sessions.sql` creates local `public.creative_sessions`, update timestamp trigger, RLS enablement, and demo policy. `20260722090000_add_auth_and_byok_settings.sql` destructively truncates demo sessions, adds their required `auth.users` owner and owner index, and creates RLS-enabled `provider_credentials` and `user_ai_settings` tables. `20260722130000_atomic_ai_settings_operations.sql` adds service-role-only RPCs that serialize routing save and credential deletion per user with transaction-scoped advisory locks. Migrations create no permissive credential/settings policies. `supabase db reset --local` applies them only to local stack.

Rollback is manual: `supabase/manual/rollback_auth_and_byok_settings.sql` first drops both atomic RPC functions, then AI settings, credentials, session owner index, and session owner column. `rollback_creative_sessions.sql` removes original session schema. These helpers are deliberately outside migration history; reset reapplies migrations rather than rolling them back.

To exercise persistent settings and atomic RPCs against local Supabase only, use values reported by `supabase status -o env`:

```env
APP_ENV=development
AUTH_MODE=supabase
SETTINGS_STORE_MODE=supabase
LLM_TRANSPORT_MODE=test
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
BYOK_MASTER_KEY=<base64-encoded-32-byte-local-key>
```

Use a local user's bearer token plus bounded `test-...` provider keys. Test transport keeps provider traffic offline while settings writes and atomic routing/delete operations use local Supabase. Never substitute a remote URL or remote service-role key, and never run this workflow against linked or production Supabase.

## Runtime behavior

`RuntimeConfig` defaults to `SETTINGS_STORE_MODE=supabase`; memory mode is never inferred from missing environment values. The lazy application composition constructs the settings store and creative-session store together. In Supabase mode it requires a URL proven to use `localhost` or `127.0.0.1`, a local service-role key, and a valid decoded 32-byte master key; missing or invalid configuration raises instead of falling back. `SETTINGS_STORE_MODE=memory` is the only way to select both in-memory stores. Authentication is configured independently: Supabase auth requires the anon key, while the service-role key is never an end-user verifier.

Create, get, and save failures propagate to the caller. Every operation includes `user_id`; in-memory keys and Hermes cache keys are `(user_id, session_id)`, while Supabase reads and updates filter both columns. Hermes rejects mismatched embedded owners/session ids before deserialization, caching, or persistence. The same composition supplies settings and session persistence to authenticated creative LLM generation, so owner routing and session state cannot silently use different persistence modes.

Local Auth/settings integration uses `SUPABASE_LOCAL_TEST_URL`, `SUPABASE_LOCAL_TEST_KEY`, and `SUPABASE_LOCAL_SERVICE_ROLE_KEY`. It skips when required environment is absent. When configured, an offline local stack fails. It proves loopback hostname before client construction, creates two disposable local Auth users, validates eight-character password policy, stores AES-GCM ciphertext for one owner, proves second-owner isolation and plaintext absence, and deletes created users through local admin API. It calls no provider. Existing session-store integration separately accepts `SUPABASE_LOCAL_TEST_USER_ID`.

Evaluate only environment output from trusted local CLI. Keep local values in current shell and run guarded integration without printing or placing key value in docs or tracked files:

```sh
eval "$(supabase status -o env)"
cd backend
SUPABASE_LOCAL_TEST_URL="$API_URL" \
SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" \
SUPABASE_LOCAL_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
python -m unittest tests.test_supabase_auth_settings -v
```

Test guard rejects every hostname except `localhost` and `127.0.0.1` before client construction.

## User AI settings and credential vault

`BYOK_MASTER_KEY` is a base64-encoded 32-byte AES key for local development. Keep it only in ignored `backend/.env.local`; never commit or reuse it outside the local environment. The current credential cipher accepts the decoded 32 bytes and uses AES-256-GCM with a new 96-bit nonce for each encryption. User id, provider slug, and key version are authenticated with the ciphertext, so an encrypted value cannot be moved to another owner or provider.

Only ciphertext, nonce, key version, and display suffix are persisted in `provider_credentials`; plaintext is never persisted. It exists only in request- and method-local memory while validation, encryption, decryption, or provider exchange needs it. Keys longer than four characters expose final four characters for display. Keys of four characters or fewer expose empty suffix so full secret is never displayed. Application logs can recursively redact known credential fields, including ciphertext and nonce.

Credential records and AI routing settings have owner-scoped in-memory and injected-client Supabase stores. In-memory domain operations share one reentrant lock. Supabase service uses two service-role-only RPCs guarded by same per-user transaction advisory lock: routing validates every target is currently connected in same transaction as optimistic save, while deletion checks routing references in same transaction as credential removal. Thus concurrent route-save/delete cannot leave dangling routing. Authentication/decryption attention marking compares exact owner, provider, ciphertext, nonce, and key version used, then updates only `connection_state` and `updated_at`; concurrent credential replacement is never overwritten. Store failures remain generic. Authenticated `/settings` routes use these atomic owner-scoped operations; transient tests/discovery do not write credentials. The creative LLM runtime is active and resolves the authenticated owner's routing through the same composition. Unit tests use memory/fake RPCs and require no real Supabase operation.

## Security status

## Spatial brand project persistence

Persistent composition now uses `SupabaseProjectStore`; memory composition keeps `InMemoryProjectStore`.
Migration `20260726090000_add_spatial_brand_projects.sql` creates owner-scoped projects, nodes,
edges, revisions, layouts, media metadata, annotations, preferences, proposals, analysis cache,
challenge resolutions, and Blueprint snapshots. Project-scoped rows carry `user_id` plus `project_id`; project roots use
`user_id` plus `id`, while user preferences use `user_id` only. Compound foreign keys prevent
cross-owner graph references. RLS is enabled without permissive policies.
Service-role-only transaction RPCs serialize semantic mutations with advisory locks and compare
expected versions. Layout and annotation versions remain separate from semantic project versions.
Proposal acceptance writes complete candidate nodes/edges and terminal proposal state in one RPC.
It compares immutable proposal identity, canonical candidate hash, target/output binding, dependency
version maps, project, title, rationale, creation source, and creation timestamp before any graph
insert, then verifies every dependency ID/version under transaction lock. `brand_analysis_requests` plus service-role-only
claim/complete/abandon RPCs provide owner/project-scoped atomic idempotency; rows bind normalized
request fingerprint to key, retain completed response, store only hashed in-flight capability, and
atomically replace pending claims after a bounded 60-second lease expires.
Completion validates returned owner, project, key, and exact result before acknowledging success;
abandonment also authenticates with hashed capability so failed provider work can safely reclaim key.
Challenge resolution records exactly one terminal resolved/deferred/overridden choice per challenge
and advances project semantic version in one owner-scoped RPC. Contradictory later records fail.
Both RPCs are service-role-only.
Absent layout and annotation collections start at version `0`. Annotation replacement accepts a
mixed set of new version-1 records, byte-for-byte unchanged records, and existing records advanced
exactly one version; it validates media references and consumes attached upload claims atomically.
Layout creation accepts only expected version `0`; later writes compare the stored version. Annotation
reads use one service-role RPC under the same project advisory lock, returning collection version and
rows from one coherent generation rather than combining independent queries.

Canvas bytes live in private local bucket `brand-canvas-media` (5 MiB; PNG, JPEG, or WebP).
Database rows contain opaque object keys only. Authorized backend reads return bytes; public URLs
are never persisted or generated. Deletion first creates a retryable metadata tombstone, removes
private bytes, then finalizes metadata; pending media is hidden from reads. Failed byte removal
cancels the tombstone, while failed finalization keeps it pending for safe retry. Manual local rollback is
`supabase/manual/rollback_spatial_brand_projects.sql`: it drops RPCs first, removes bucket objects
and bucket metadata, then drops tables in reverse dependency order. It is intentionally outside
migration history. A later `supabase db reset --local` reapplies migration history; never use reset
without first proving explicit loopback local configuration.

If metadata insertion fails after upload and immediate object compensation also fails, persistence
raises a typed cleanup-required failure plus a random store-issued capability retained in the owning
store's private pending registry. Retry removal from the same private local bucket through
`SupabaseProjectStore.retry_media_cleanup` with the exact owning user/project and captured typed
failure before retrying upload. Retry atomically reserves the capability before Storage I/O, restores
the same capability after failure, and consumes it after success; forged, concurrent, replayed, or
mismatched capabilities are rejected. No
public URL or secret is exposed. Attached media claims are consumed atomically; replaying a consumed
claim returns false and cannot tombstone attached media.

Guarded project integration requires all three variables below and validates URL hostname before
constructing any client. Missing variables skip; configured offline local service fails:

```sh
SUPABASE_LOCAL_TEST_URL="$API_URL" \
SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" \
SUPABASE_LOCAL_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
python -m unittest tests.test_supabase_projects -v
```

No remote Supabase operation is allowed. Never run `supabase link`, `supabase db push`, linked
migrations, or remote mutation for this workflow.

The original `creative_sessions` RLS policy still allows all reads and writes for local demo, so direct database access is not production-safe even though authenticated application queries are owner-scoped. Credential and AI-setting tables have RLS enabled without permissive anonymous policies. Credential encryption, owner-scoped stores, atomic settings RPCs, client login/token forwarding, Settings UI, and authenticated creative LLM routing are implemented. Restrictive production hardening and deployment remain deferred.
