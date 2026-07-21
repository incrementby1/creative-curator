# Devlog

## 2026-07-22 — Encrypted user AI settings vault

Provider credentials can now be encrypted with AES-256-GCM under a 32-byte local master key. Every write uses a unique 96-bit nonce and binds ciphertext to its user, provider, and key version. Stored credential records contain only ciphertext, nonce, key version, and a safe masked suffix; short secrets never expose their full value. Sensitive nested log context can be copied with credential-bearing fields redacted.

New in-memory and injected-client Supabase settings stores isolate credentials and routing by owner. In-memory reads and writes share a reentrant lock, making same-version routing saves atomic. Primary provider and model are required together, and fallback targets are copied into a validated immutable tuple. Credential replacement and deletion remain owner-scoped, while routing writes use optimistic versions and reject stale updates, zero-row compare-and-swap results, and first-insert races. Supabase mutations explicitly refresh UTC `updated_at` without resetting `created_at`. Unit coverage uses only in-memory objects and fake Supabase queries; no local or remote database operation ran.

Local setup reserves `BYOK_MASTER_KEY` as a base64-encoded 32-byte value. No credential or routing HTTP routes, client UI, provider registry, or external provider calls exist yet. Restrictive RLS hardening remains deferred.

## 2026-07-22 — Authenticated creative API ownership

All creative routes now require bearer authentication. Supabase mode verifies end-user access tokens with the local anon key; guarded test mode accepts only non-empty `test-user:<id>` tokens and remains forbidden in production. Runtime environment accepts only `development`, `test`, or `production`, preventing production-guard bypass through aliases or typos. Missing, malformed, invalid, and expired credentials return the same token-free `401` with `WWW-Authenticate: Bearer`. Health remains public and verifier construction is lazy, so missing auth configuration cannot prevent health startup. The verifier/client is cached without caching tokens or identity results.

Each route passes the verified user id into Hermes. A second user therefore receives the same `404` as any missing session when attempting reject, approve, or execute. The temporary configured owner bridge and memory fallback owner are removed. Client login and bearer forwarding remain pending, so current client E2E is expected to remain unauthenticated until the client auth task lands.

Deferred: client authentication, restrictive creative-session RLS, runtime provider/API/UI support, dashboard and session recovery, freeform chat, and LLM-backed generation.

## 2026-07-22 — User-owned session persistence schema

Creative sessions now carry an internal user owner. Hermes lifecycle calls, cache keys, in-memory persistence, and Supabase create/read/update queries are owner-scoped; foreign or internally inconsistent owner/session state returns session-not-found without caching or mutation. At this milestone, HTTP routes still used a temporary configured owner pending verified request identity; the authenticated creative API milestone above supersedes that bridge.

New local reset migration truncates pre-ownership demo sessions, adds the `creative_sessions.user_id` foreign key/index, and creates RLS-enabled provider credential and user AI settings tables without permissive anonymous policies. Matching manual rollback removes additions in reverse dependency order. No migration was applied by this change.

Deferred: request authentication, restrictive creative-session RLS, encrypted credential/runtime provider support, dashboard and session recovery, freeform chat, and LLM-backed generation.

## 2026-07-22 — Guided Workspace integration

Hermes is now source of truth for one strict creative session. FastAPI exposes typed start, reject, approve, and execute contracts; lifecycle is `active` → `refined_ready` → `approved` → `executed`. Two distinct direction rejections are required before refinement, approval cannot skip refinement, and execute is idempotent.

Persistence transitions now use copy, persist, then cache-swap semantics. Failed create/save cannot advance in-memory state, and retries remain valid after store recovery. Approval is also idempotent for approved/executed sessions so a lost successful HTTP response does not strand client in conflict loop.

Client moved demo to root Guided Workspace with shared Brief, DNA, and Outputs session state. `/studio` now redirects to `/`. Workspace provider owns Brief and rejection drafts, preserves them after failed requests/navigation, and clears them with request epoch on Start over. Network failures show stable service-unavailable message; missing sessions offer direct reset. Mobile navigation is modal with inert background, trapped focus, restored opener focus, and responsive overlay cleanup. Browser refresh intentionally loses React-only state. Final SVG is encoded into image data URL rather than injected as live HTML.

Coverage now includes backend lifecycle/API checks and Playwright Guided Workspace flow, validation preservation, retry semantics, redirect, responsive navigation, and artifact rendering. Runtime contract is Python 3.11+. Project AGENTS governance now requires authoritative docs stay synchronized with implementation.

Persistence remains optional local Supabase only. Available migration creates `creative_sessions` when applied to local stack; manual rollback helper is separate so reset does not automatically remove schema. In-memory fallback covers Supabase store construction/config initialization only; create/get/save failures propagate. Live local persistence integration skips only when local URL/key env is absent and fails if configured Docker/local stack is offline. Current permissive RLS is explicitly demo-only and not production-safe.

Deferred at that milestone: remote RLS hardening, authentication and ownership, dashboard and session recovery, freeform chat, and LLM-backed generation.

## 2026-07-15 — First MVP branch

Initial branch established FastAPI API, deterministic Hermes agents, Next.js client, local setup instructions, and backend tests. Later integration superseded its loose demo flow with current strict Guided Workspace contract.
