# Devlog

## 2026-07-23 — Typed creative LLM agents

Creative DNA, direction, critique, and content agents now request immutable strict Pydantic outputs through the owner-scoped structured LLM router. Stable role prompts contain no user-controlled text; intake, feedback, rejection, and session context remain structured user data. Application code assigns public direction IDs, and schema validation rejects malformed shapes, coercive slider values, duplicate directions, unsafe colors, empty content, and unapproved layout types.

Final content generation requests a bounded layout specification rather than model-authored SVG. A fixed renderer revalidates every palette color, removes XML-forbidden controls, escapes brand and model text, and emits only a fixed SVG element and attribute template. Focused tests use fake routers only; no provider, Supabase, or network operation ran. Production Hermes composition is intentionally deferred to the next integration milestone.

## 2026-07-22 — Authenticated AI settings API

Added owner-scoped provider settings endpoints. Public catalog mirrors pinned 28-provider Hermes manifest; transient tests and discovery never save supplied keys or inherit stored endpoints, while test-and-save encrypts only after provider success. OpenAI-compatible, Anthropic, Gemini, and Copilot model-list adapters reuse pinned-IP, no-redirect, bounded-response transport controls. Stored custom endpoints are reused only with stored credentials, model output is sorted and de-duplicated, unsupported providers request manual entry, and stored authentication failures compare-and-swap exact credential to `needs_attention`.

Routing accepts only connected known providers, caps fallbacks at five, uses optimistic versions, and blocks disconnect while referenced. In-memory store uses one lock for routing/save-delete invariants; Supabase composition uses service-role-only local migration RPCs with shared per-user transaction advisory lock. Guarded test transport accepts bounded `test-...` fixture keys, returns deterministic model ids, and creates no HTTP client; production rejects it. API errors mask plaintext, encrypted fields, upstream bodies, raw exceptions, and FastAPI validation input. Cached owned live transport closes during shutdown. Tests use memory stores and fake RPC/provider operations; no live provider, migration, or Supabase operation ran.

## 2026-07-22 — Owner-scoped provider routing

Backend now has provider-neutral chat, Responses, Anthropic, Gemini, and Copilot transports plus strict structured-output routing. Manifest rules select key-prefix, endpoint-suffix, model-prefix, fixed, then default chat transports; Kimi coding endpoints are pinned by key rule, Anthropic paths avoid duplicate `/v1`, Gemini keeps its key out of URLs, and Copilot tokens are exchanged only at the fixed GitHub endpoint without caching. HTTP behavior uses explicit timeouts, no retries or redirects, and one DNS resolution immediately before every request. All answers must be global; a deterministic validated address replaces the hostname in the connect URL, while the original authority remains in `Host` and the original hostname reaches httpcore TLS verification through `sni_hostname`. Owned clients ignore environment proxies and disable keepalive to prevent cross-host reuse of a pinned-IP connection. Responses stream into a bounded buffer, stop as soon as the cap is crossed, and reject an oversized `Content-Length` without consuming chunks. The dispatcher owns and closes only clients it creates; runtime shutdown wiring remains deferred until agent integration.

That pinned-IP TLS mechanism is security-coupled to reviewed HTTPX `0.28.1` and httpcore `1.0.9` internals, so both dependencies are exact pins. Upgrades require fresh source-boundary review and regression verification. Production dispatcher construction always creates the hardened client; injected protocol fakes require an explicit test-only keyword and opt-in and are never closed by the dispatcher.

Structured routing reads only owner-scoped settings and credentials, decrypts keys into method-local request state, deduplicates the primary plus at most five fallbacks, and preserves each concrete Pydantic output type. Invalid JSON or schema receives exactly one bounded same-provider repair before fallback. Authentication and decryption failures atomically mark the exact credential version used as `needs_attention`; a concurrent key replacement makes that compare-and-swap a no-op. Marking failure does not block later fallbacks. Final errors contain ordered slugs and safe categories only, never keys, upstream bodies, raw exceptions, or invalid output. Tests use injected HTTP clients and resolvers; no provider or Supabase call ran.

Credential/routing settings HTTP endpoints and client controls remain pending. Creative agents are still deterministic and do not use this router, so live AI is not active in application flows.

## 2026-07-22 — Pinned Hermes provider compatibility

Backend settings now include a versioned, validated static manifest for 28 approved API-key providers. Metadata is pinned to the official `NousResearch/hermes-agent` repository at commit `8208fc52701332f213e6c51ebc0b610be00300de` and records ordered credential aliases, default and override endpoints, transports, model-discovery behavior, manual model entry, and explicit Kimi, OpenCode, Azure Foundry, and custom-endpoint routing rules. Package-relative loading is independent of process working directory; frozen entries, typed rule records, tuples, and a read-only index prevent caller mutation, including through direct constructors and source aliases. Validation rejects malformed source metadata, aliases, capabilities and rules, duplicate routing selectors, unsafe URLs, credentials in URLs, noncanonical numeric hosts, non-global IP literals, and non-HTTPS endpoints. Exact loopback HTTP is available only through an explicit test-only constructor option. URL validation is deterministic and offline; future transports must re-resolve DNS before connection and revalidate redirect targets.

This snapshot narrows Hermes to approved API-key flows. LM Studio and other local no-key providers, OAuth/device-code providers, AWS SDK credential chains, and external-process providers are excluded. No provider API call, key use, Supabase operation, or HTTP settings route was added. Future compatibility changes require a deliberate review against a new immutable official Hermes commit plus manifest, regression-test, and documentation updates in the same change.

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
