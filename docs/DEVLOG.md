# Devlog

## 2026-07-27 — Client graph and unit-test foundations

Client now pins React Flow, Motion, Lucide React, `perfect-freehand`, class composition helpers, Vitest, jsdom, and Testing Library. Next.js and its matching ESLint configuration are pinned to 16.2.12. Vitest uses jsdom, repository aliases, and shared DOM matchers; shadcn-compatible local component aliases add no runtime registry dependency. Client-quality CI runs unit tests before production build while retaining lint, type, build, and separate Playwright gates.

## 2026-07-27 — Immutable Starter Brand Blueprints

Owner-scoped readiness now evaluates eleven required Blueprint sections from live semantic nodes only. Each section needs an approved decision and no unresolved blocking challenge; early snapshots remain available with explicit warnings and unresolved assumption IDs. Evidence/assumptions and unresolved-challenges aggregate all corresponding live nodes, including advisory non-blocking challenges in readable content without treating them as blockers. Deterministic compilation records canonical JSON, semantic project version, per-project sequence, source nodes/edges, and UTC creation time. Same-version requests return one existing snapshot, while later graph changes create immutable history. Compiler uses one snapshot-history read for existing detection and next sequence. Every request, including same-version replay found during pre-read, enters atomic snapshot persistence; it locks and rechecks expected semantic version before existing-row lookup, preventing a racing graph mutation from returning or storing stale input. A concurrent exact winner may supply the authoritative sequence; mismatched canonical or source payload is rejected. Four authenticated readiness/history endpoints expose canonical server output. Supabase snapshot rows enforce unique project-version and sequence identity through a service-role-only RPC. Canvas layout, annotations, and media never enter readiness or compilation.

## 2026-07-27 — Authenticated spatial project API

Owner-scoped FastAPI routes now expose versioned projects, nodes, relationships, revisions, isolated layout/annotations, streamed canvas media, and global/project themes. Verified identity hides foreign records behind safe project `404`s; stable errors cover optimistic conflicts, invalid media, and store failure without echoing submitted content. Annotation requests have an 8 MiB pre-parser ASGI cap and raw pre-model 50,000-point aggregate budget; chunks are checked before buffering. PNG/JPEG/WebP uploads reject over-limit chunks before copying and return a one-time high-entropy attachment claim whose hash alone is stored separately. Failed-attachment cleanup precomputes claimed media across the whole validated annotation request, independent of annotation ID/order; successful attachment atomically consumes claims, preventing wrong-claim, replay, or later-detachment deletion. Hydrated annotations now validate enum values and round-trip through the API. Application composition reuses one in-memory project store/service while preserving existing shutdown ownership. Focused and full backend regressions cover authorization, isolation, versioning, non-semantic separation, theme precedence, and media lifecycle.

## 2026-07-27 — Atomic spatial project service

Project graphs now have an owner-scoped service for quick capture, full semantic node edits and revisions, live-node relationships, soft trash/restore, decision approval, isolated layout/annotation/media state, and global/project theme precedence. Semantic mutations use atomic record-and-project compare-and-swap store hooks; full prior semantic node fields are captured in immutable revisions. Annotation replacement validates CAS, hydrated record invariants, version transitions, and media references in one locked commit; concurrent media deletion cannot create dangling annotations. Layout persists strict finite numeric coordinates as floats. PNG, JPEG, and WebP canvas media is magic-byte checked, MIME matched, SHA-256 validated, capped at 5 MiB, and stored under opaque UUID keys. Atomic deletion rejects media still referenced by persisted annotations. Regression coverage proves non-semantic writes leave project versions, graph records, revisions, analysis state, snapshots, and readiness-relevant graph inputs unchanged.

## 2026-07-25 — Gemini structured output and deterministic parsing

Gemini `v1beta generateContent` now receives a provider-compatible projection of the concrete Pydantic JSON Schema through the accepted legacy `generationConfig.responseMimeType` and `responseJsonSchema` fields, while keeping the API key in its header. A bounded live compatibility probe showed the newer `responseFormat` field returning `400 INVALID_ARGUMENT` for configured `gemini-3.5-flash`, while the legacy shape returned `200`. Gemini-unsupported string length and regex keywords are omitted from the provider payload without removing same-named object properties; the unchanged original schema remains the strict application boundary. Before spending the existing single same-provider repair, the router can deterministically accept a complete outer JSON fence or a sole `output` wrapper around otherwise valid schema-conforming JSON. It does not perform permissive JSON repair, substring extraction, or type coercion; malformed and schema-invalid output still repairs once, falls back in configured order, and ends in secret-safe `invalid_response` when exhausted.

The parser design was independently implemented after reviewing n8n's structured-output and one-shot auto-fixing architecture; no n8n source or prompt was copied. Offline regressions cover the exact Gemini payload, fenced and wrapped output, literal backticks, incomplete fences, bounded repair, and existing secret-safe failure behavior. Two bounded Gemini compatibility probes ran against the saved local credential: the rejected new request shape and the accepted legacy request shape. No Supabase mutation, migration, or UI operation ran.

## 2026-07-24 — Documentation ownership cleanup

The root README now serves as the project entry point for quick start, local-persistence summary, verification, architecture, and links to authoritative documentation. Detailed product, API, persistence, transport, and security contracts remain in their owning files under `docs/`. The redundant branch-style `docs/CHANGELOG.md` was removed; pull requests carry branch-specific change and verification details, while this devlog remains the concise permanent project history. No runtime behavior changed.

## 2026-07-24 — Required GitHub Actions verification

Pull requests and pushes to `main` now run three least-privilege GitHub Actions checks: the Python 3.11 backend suite, Node.js 22 client lint/type/build gates, and Chromium Playwright E2E against the deterministic in-memory FastAPI composition. The E2E job installs backend dependencies explicitly and points Playwright at the runner Python, so it does not depend on a local `.venv`. CI consumes no repository secrets and performs no remote Supabase or live-provider operation. A repository contract test prevents silent removal of mandatory gates or introduction of remote mutation commands.

## 2026-07-23 — OpenAI Responses structured outputs

OpenAI Responses generation now sends the concrete Pydantic JSON Schema through `text.format` with `type: "json_schema"` and `strict: true`, matching the official Responses Structured Outputs contract. Format names are deterministic internal snake-case identifiers derived from output model types and contain no user-controlled data. The single same-provider repair reuses the exact name, schema, and strict format contract. Returned text still passes strict Pydantic validation after both initial generation and repair; malformed or schema-invalid output becomes safe `invalid_response` fallback state after one failed repair.

Response reads and the invalid-output repair excerpt stay bounded, while final failures expose only ordered provider slugs and safe categories, never keys, user input, upstream bodies, raw output, or validation internals. Offline regressions inspect exact Responses payload shape, schema-name determinism, repair parity, OpenAI-supported creative schema shapes, safe failed-repair behavior, and a schema-enforcing end-to-end creative start through an injected fake HTTP transport. No live provider or Supabase operation ran.

## 2026-07-23 — Guarded local Auth/BYOK workflow

Local Supabase Auth now keeps signup enabled, auto-confirms email, and enforces an eight-character minimum password. New guarded integration proves loopback hostname before client construction, creates/signs in two disposable local users, persists AES-256-GCM provider ciphertext for one owner, verifies second-owner isolation and plaintext absence, and deletes users through local admin API. It touches local Auth/PostgREST only and makes no provider request.

Tracked backend/client environment examples now contain loopback URLs and placeholders only. README, API, client flow, Supabase workflow, demo tutorial, and agent rules document login, Settings, persistence/fallback/error behavior, local migration/rollback/startup/test steps, master-key generation, missing browser session recovery, approved product/design/plan pointers, and no-remote-operation boundary. Local database was reset and Auth container restarted to apply config; no remote Supabase or provider operation ran. Production Supabase hardening remains deferred.

## 2026-07-23 — Shared Clear Workbench shell

Protected Workspace and Settings now share one route-group layout, account navigation, and persistent Workspace provider. Client-side Settings visits preserve unsaved Brief and rejection state while refresh retains the documented React-only reset boundary. Desktop uses flat side navigation; mobile keeps workspace and account destinations in one focus-contained drawer with opener restoration. Cross-route choices and sign-out close the drawer and restore its opener; failed resolved or thrown sign-out remains accessible outside inert content. The main-content skip link becomes inert and leaves accessibility/tab navigation while the drawer is modal, then returns when it closes. Sign-out remains spatially separated from primary navigation.

Workspace styling now follows approved Clear Workbench tokens: OKLCH mineral surfaces, one sans-serif hierarchy, flat tonal grouping, one-pixel borders, 8-pixel radii, sentence-case labels, 44-pixel targets, overlay-only shadow, and reduced-motion overrides. Editorial serif/fluid display type, decorative texture, gradients, glass effects, staggered cards, persistent shadows, and side-stripe alerts were removed. Creative requests now use the shared authorized JSON client; typed missing-routing errors link directly to Settings. Browser tests authenticate and configure a deterministic provider before workspace flows, cover draft preservation and desktop/mobile visual rules, and retain lifecycle, stale-response, retry, focus-trap, safe-SVG, and overflow coverage. No provider, remote Supabase, or migration operation ran.

## 2026-07-23 — Persistent BYOK Settings workspace

Protected `/settings` now connects browser to owner-scoped provider and routing APIs. Labeled search filters manifest-ordered providers by display name or slug with result count and empty recovery. Flat provider rows expose explicit state words and selected routing use through one contextual Connect or Manage action. Expanded management contains inline password/reveal and endpoint controls, transient connection testing, model discovery with manual entry, revalidated replacement, masked suffixes, and spatially separated inline disconnect confirmation with focus transfer/restoration. Pending deletion locks confirmation teardown and draft mutation until the real response completes; no fake cancellation is offered. Raw keys exist only in transient React state, clear after save or successful disconnect, and never enter browser storage or render after submission; failed saves and disconnects retain correction drafts with safe errors. Routing supports one primary and five ordered fallbacks with connected-reference, model, and exact-pair uniqueness gates, labeled move/remove controls, visible per-provider model use, preserved-but-disabled stale selections, empty-route clearing even when last provider needs attention, and optimistic-conflict reload.

Shared authorized JSON client obtains current access token per attempt, sends Bearer authentication, safely parses typed FastAPI errors and empty `204` responses, retries one `401`, and returns final unauthorized request to login with intended route. Playwright coverage exercises masking across logout/login, owner isolation, discovery, disconnect focus, route ordering/cap, conflict recovery, API retry/error behavior, and 375-pixel overflow/target rules. UI reference fallback used Ruixen UI's `Auth Dialog` for explicit mode/label patterns and `Password Field` for secret reveal/accessibility; markup was rebuilt for approved Clear Workbench system. No suitable provider-routing catalog component was used, and no component was copied unchanged. No provider, remote Supabase, or migration operation ran.

## 2026-07-23 — Supabase SSR email/password authentication

The Next.js client now provides email/password sign-in and sign-up through lazy Supabase SSR browser/server clients. A Next.js 16 proxy refreshes production sessions with `getUser()`, faithfully carries refreshed cookies, and protects the workspace and reserved settings destination while retaining a safe relative intended route. Creative requests attach the current end-user bearer token. The login workbench includes blur validation, generic credential failure, pending state, password reveal semantics, keyboard focus recovery, responsive layout, and sign-out.

Playwright uses a doubly guarded, deterministic cookie auth client with a stable email-derived `test-user:<id>` token and fixed password. It creates no Supabase client or auth network traffic, persists through refresh, restores identity after logout/login, and is unavailable to production builds. The harness now configures exact offline backend modes and disables traces. Persistent BYOK Settings milestone above supersedes earlier deferral.

## 2026-07-23 — Authenticated Hermes BYOK lifecycle

The authenticated creative lifecycle now uses explicit injected stores, routing readiness, typed LLM agents, and the owner-scoped structured router. Start verifies that the owner has routing before generation or session creation; reject and execute validate the owned session and transition before new AI work. Every generative agent call carries the authenticated user id. Candidate state is copied, generated, persisted, and only then swapped into cache, so provider and persistence failures leave the previous state retryable.

Settings and creative APIs share one lazy application composition. Concurrent cold requests construct it once; clearing detaches and closes that instance once, while a failed build remains retryable. Live mode owns one dispatcher shared by provider settings operations and structured generation and closes it once at shutdown. Guarded test mode constructs no dispatcher or HTTP client and supplies deterministic schema-valid outputs for the complete creative lifecycle. Missing routing maps to a safe `409` code and exhausted providers to a safe `503` containing ordered provider slugs and public failure categories only. Mutations reload persisted session state rather than trusting cache, while their lock provides only in-process serialization, not distributed compare-and-swap. Coverage verifies owner routing, failure retry semantics, persisted-state refresh, safe API errors, zero-network test composition, and dispatcher lifecycle. The full backend suite uses memory by default; no provider, remote Supabase, or network operation ran.

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

At that milestone, credential/routing HTTP endpoints and client controls remained pending, and creative agents were still deterministic. Later entries above supersede both limitations.

## 2026-07-22 — Pinned Hermes provider compatibility

Backend settings now include a versioned, validated static manifest for 28 approved API-key providers. Metadata is pinned to the official `NousResearch/hermes-agent` repository at commit `8208fc52701332f213e6c51ebc0b610be00300de` and records ordered credential aliases, default and override endpoints, transports, model-discovery behavior, manual model entry, and explicit Kimi, OpenCode, Azure Foundry, and custom-endpoint routing rules. Package-relative loading is independent of process working directory; frozen entries, typed rule records, tuples, and a read-only index prevent caller mutation, including through direct constructors and source aliases. Validation rejects malformed source metadata, aliases, capabilities and rules, duplicate routing selectors, unsafe URLs, credentials in URLs, noncanonical numeric hosts, non-global IP literals, and non-HTTPS endpoints. Exact loopback HTTP is available only through an explicit test-only constructor option. URL validation is deterministic and offline; future transports must re-resolve DNS before connection and revalidate redirect targets.

This snapshot narrows Hermes to approved API-key flows. LM Studio and other local no-key providers, OAuth/device-code providers, AWS SDK credential chains, and external-process providers are excluded. No provider API call, key use, Supabase operation, or HTTP settings route was added. Future compatibility changes require a deliberate review against a new immutable official Hermes commit plus manifest, regression-test, and documentation updates in the same change.

## 2026-07-22 — Encrypted user AI settings vault

Provider credentials can now be encrypted with AES-256-GCM under a 32-byte local master key. Every write uses a unique 96-bit nonce and binds ciphertext to its user, provider, and key version. Stored credential records contain only ciphertext, nonce, key version, and a safe masked suffix; short secrets never expose their full value. Sensitive nested log context can be copied with credential-bearing fields redacted.

New in-memory and injected-client Supabase settings stores isolate credentials and routing by owner. In-memory reads and writes share a reentrant lock, making same-version routing saves atomic. Primary provider and model are required together, and fallback targets are copied into a validated immutable tuple. Credential replacement and deletion remain owner-scoped, while routing writes use optimistic versions and reject stale updates, zero-row compare-and-swap results, and first-insert races. Supabase mutations explicitly refresh UTC `updated_at` without resetting `created_at`. Unit coverage uses only in-memory objects and fake Supabase queries; no local or remote database operation ran.

At that milestone, local setup reserved `BYOK_MASTER_KEY` while HTTP routes, client UI, provider registry, and external calls remained absent. Later entries above implement routes/UI/registry; restrictive RLS hardening remains deferred.

## 2026-07-22 — Authenticated creative API ownership

All creative routes now require bearer authentication. Supabase mode verifies end-user access tokens with the local anon key; guarded test mode accepts only non-empty `test-user:<id>` tokens and remains forbidden in production. Runtime environment accepts only `development`, `test`, or `production`, preventing production-guard bypass through aliases or typos. Missing, malformed, invalid, and expired credentials return the same token-free `401` with `WWW-Authenticate: Bearer`. Health remains public and verifier construction is lazy, so missing auth configuration cannot prevent health startup. The verifier/client is cached without caching tokens or identity results.

Each route passes the verified user id into Hermes. A second user therefore receives the same `404` as any missing session when attempting reject, approve, or execute. The temporary configured owner bridge and memory fallback owner are removed. Client login and bearer forwarding were pending at that milestone and are implemented by later entries above.

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
## 2026-07-27 — Local spatial brand persistence

Added owner/project-scoped local Supabase graph tables, restrictive RLS posture, private bounded
canvas media storage, service-role-only advisory-lock/CAS RPCs, reverse-order manual rollback, and
`SupabaseProjectStore` composition. Offline fake-client coverage checks scope, sanitized failures,
RPC payloads, row identity, and protocol completeness. Live integration remains guarded by three
explicit local variables and loopback proof; absent variables skip. No migration, reset, provider,
remote Supabase, or network operation ran.

Follow-up hardening aligned annotation/layout collection version `0` semantics with memory mode,
validated mixed annotation transitions and prior-node revisions under lock, preserved exact accepted
proposal candidates, compensated every post-upload metadata failure, and made media deletion a
retryable begin/remove/finalize tombstone workflow.

## 2026-07-27 — Cached Hermes graph proposals

Added owner-scoped relevant-subgraph analysis, dependency-specific semantic cache fingerprints,
strict proposal reference validation, preview-only pending proposals, atomic version-checked
acceptance, idempotent accepted retries, and immutable challenge resolution/defer/override records.
Four authenticated project endpoints expose analysis, proposal listing/acceptance, and challenge
resolution with safe configuration/provider/conflict/not-found errors. Layout, annotations, and media
remain excluded from Hermes context and cache dependencies. Local Supabase schema adds restrictive
challenge-resolution persistence and service-role-only atomic RPC. No provider, network, migration,
or remote Supabase operation ran.

Follow-up hardened analysis idempotency with atomic owner/project/key claims in memory and local
Supabase, exact completed-response replay, mismatched/in-progress conflict handling, and failed-claim
release. Cached structured output now survives accepted/rejected proposal lifecycle and can seed a
new pending preview without provider work when semantic dependencies remain unchanged. Proposal
listing reparses and revalidates candidates; corrupt/missing cache fails safely. Atomic acceptance
now rejects immutable proposal-field tampering, and in-memory challenge resolution enforces resolver
ownership parity with SQL.

Regression coverage proves provider failure abandons an in-flight analysis claim, same key can retry
successfully, and later replay adds no provider call or duplicate proposal. Local persistence tests
verify exact completion payload/result identity, hashed abandonment capability, typed lost-claim
conflicts, and guarded loopback-only abandon/reclaim behavior.

Final Task 7 hardening binds each proposal to a persisted canonical SHA-256 candidate/dependency
fingerprint and affected targets. Acceptance rechecks all dependency node and edge versions against
live records inside memory and SQL atomic commits, preventing stale or cache-mutated candidates from
changing graph state. Analysis claims now expire after a bounded lease and support atomic takeover
after process death. Challenge resolution is terminal: one immutable choice per challenge, with later
contradictory records rejected consistently by memory, API, and SQL persistence.

Completed idempotency replay now reconstructs and verifies project scope, targets, dependency maps,
and canonical candidate hash before returning persisted output. Accepted proposal retries validate
immutable cache binding, then return stored accepted records before live dependency/version checks,
so later graph edits and arbitrary stale retry versions cannot reapply or block the accepted result.
