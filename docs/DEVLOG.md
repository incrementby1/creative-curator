# Devlog

## 2026-07-22 — User-owned session persistence schema

Creative sessions now carry an internal user owner. Hermes lifecycle calls, cache keys, in-memory persistence, and Supabase create/read/update queries are owner-scoped; foreign or internally inconsistent owner/session state returns session-not-found without caching or mutation. HTTP routes use a temporary resolver until request authentication supplies verified identity: memory mode has a deterministic valid UUID, while local Supabase requires a valid `CREATIVE_DEMO_USER_ID` for an existing auth user and fails with `503` before persistence when missing or malformed.

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
