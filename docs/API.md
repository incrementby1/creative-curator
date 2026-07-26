# API contract

The Next.js client proxies `/api/creative/*` to FastAPI `/creative/*`. All API payloads are JSON. The four POST routes below are the creative workflow contract.

Every `/creative/*` request requires `Authorization: Bearer <access-token>`. In Supabase auth mode, the backend verifies the end-user access token with the configured local Supabase project and derives session ownership from the verified user id. The verifier and Supabase client are reused, but token results and user identities are never cached. Development test mode accepts only non-empty `test-user:<id>` tokens and is forbidden when `APP_ENV=production`. `APP_ENV` accepts exactly `development`, `test`, or `production`; aliases and typos fail closed. `/health` remains public.

Creative and settings requests share the browser's authorized JSON client. It obtains a fresh current Supabase access token for each attempt, attaches it to the proxied request, safely parses typed FastAPI errors, retries one `401`, and returns to login on a final `401`. The workspace maps typed `ai_configuration_required` to direct Settings recovery. The Next.js proxy refreshes Supabase cookies with `getUser()` and never authorizes from `getSession()`. Guarded Playwright auth supplies the same backend-compatible `test-user:<id>` bearer token from its cookie without constructing Supabase.

In local Supabase mode, account rows, encrypted provider credentials, routing, and owner-scoped creative sessions persist across backend restart. This persistence is an HTTP/backend capability only: client has no saved-session listing or recovery endpoint, so browser refresh cannot restore active creative state.

## AI provider settings

Every `/settings/*` request requires same bearer identity as creative routes. Settings are owner-scoped. Responses expose public Hermes manifest metadata, connection status, configured endpoint, test time, and final four-character mask only. They never expose API-key plaintext, ciphertext, nonce, upstream bodies, or validation input. Invalid request errors contain only safe type, location, and message fields.

The browser proxies `/api/settings/*` to these routes. Its authorized JSON client reads current auth token for every attempt, adds bearer header, and parses FastAPI detail objects and validation arrays into safe messages. It retries one `401` once after another normal auth-client token read, then returns to login with same-origin intended route on final `401`. `204` disconnect responses do not require JSON body.

`GET /settings/providers` returns `manifest_version` plus pinned providers in manifest order. Each provider includes `slug`, `display_name`, `key_names`, default and override endpoint metadata, discovery/manual-entry capabilities, `state` (`not_connected`, `connected`, or `needs_attention`), `masked_suffix`, `configured_base_url`, and `tested_at`.

`POST /settings/providers/{slug}/test` tests without saving. Body is `{"api_key":"..." | null,"model":"...","base_url":"..." | null}`; null key uses authenticated owner's stored key and stored custom endpoint when no endpoint is supplied. A supplied transient key never inherits stored endpoint configuration: it uses explicit `base_url` or provider default. Providers with model discovery use that non-generative check; others use a minimal completion. Success is `{"ok":true}`.

`POST /settings/providers/{slug}/models` accepts `{"api_key":"..." | null,"base_url":"..." | null}`. It returns a sorted, de-duplicated list: `{"models":["model-a"],"manual_entry_required":false}`. A provider without discovery support returns `{"models":[],"manual_entry_required":true}` without provider traffic. Empty discovered results also require manual entry. Transient keys are never persisted.

`PUT /settings/providers/{slug}` tests then replaces that owner's credential. Body requires `api_key` (1–4096 characters), `model` (1–240), and optional safe HTTPS `base_url`. Response contains `provider_slug`, `state`, `masked_suffix`, `configured_base_url`, and `tested_at` only. Failed test preserves prior credential. Testing a stored credential that receives authentication failure compare-and-swaps exact credential to `needs_attention`.

`DELETE /settings/providers/{slug}` returns `204`. If primary or fallback routing still references it, response is `409 {"detail":{"code":"provider_in_use"}}`; clear routing first. Reference check and deletion are one atomic store operation.

`GET /settings/routing` returns `primary` (target or null), `fallbacks`, and optimistic `version`. `PUT /settings/routing` accepts same shape. Each target is `{"provider_slug":"...","model":"..."}`; only connected known providers are accepted and fallback count is at most five. Connection validation and versioned save are one atomic store operation. Stale write returns `409 {"detail":{"code":"settings_version_conflict"}}`.

In a non-production environment with `LLM_TRANSPORT_MODE=test`, composition uses offline deterministic provider operations. Keys must match bounded test-only syntax: `test-`, one ASCII letter or digit, then up to 127 ASCII letters, digits, `.`, `_`, or `-`; approved examples include `test-openrouter-4F2A` and `test-key-4F2A`. Empty, oversized, malformed, and non-test keys fail authentication. Supported discovery returns `<provider-slug>-test-model`. No HTTP client or outbound request is created. Runtime configuration forbids this mode in production.

Provider exchange failures are safe `422` responses with `provider_connection_failed` plus public category. Unknown provider is `404`; disconnected/invalid routing and invalid endpoint configuration are `422`. No raw provider exception or body crosses HTTP boundary.

## Internal LLM routing

Backend internals can resolve an owner's configured primary provider plus at most five fallbacks and request a strict Pydantic JSON result. JSON or schema failure receives one bounded same-provider repair attempt before fallback. Missing routing raises `AiConfigurationRequired`; exhausted routes raise `AllProvidersFailed` containing only ordered provider slugs and safe categories (`auth`, `timeout`, `rate_limited`, `unavailable`, `invalid_response`, or `configuration`). Keys, upstream bodies, invalid model output, raw exceptions, and user input are never part of public failure text. Authentication and decryption failures compare-and-swap only the exact owner/provider credential version used to `needs_attention`, so concurrent credential replacement is preserved.

For OpenAI Responses transports, every structured generation request follows the [official Responses Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs): `text.format` contains `type: "json_schema"`, the Pydantic model's JSON Schema, and `strict: true`. Its format `name` is a deterministic internal snake-case name derived only from the output model type, never API keys or user data. The one permitted same-provider repair carries the identical format name, schema, and strict contract. Provider-side schema enforcement is not trusted as the application boundary: received text is still parsed and validated against the concrete Pydantic model with strict validation after both the initial response and repair.

Gemini requests use the legacy `v1beta generateContent` endpoint and its accepted structured-output fields: `generationConfig.responseMimeType` is `application/json`, while `generationConfig.responseJsonSchema` carries a provider-compatible projection of the Pydantic JSON Schema. The newer `generationConfig.responseFormat` shape is not used because a live compatibility probe against configured `gemini-3.5-flash` rejected it with `400 INVALID_ARGUMENT`, while the legacy fields succeeded. Unsupported Gemini keywords such as string length and regex constraints are omitted only from the provider payload; the original schema remains unchanged for strict application validation. Property names that match schema-keyword names are preserved. The API key remains in the `x-goog-api-key` header, and provider-side enforcement is never trusted as the application boundary.

Before using the one model repair, the router performs only deterministic envelope normalization inspired by established structured-parser practice: it accepts raw JSON, a complete whole-response plain or `json` Markdown fence, or an object whose sole key is `output`. It never extracts an arbitrary substring, repairs JSON syntax locally, coerces types, or relaxes the schema. Backticks inside valid JSON strings are preserved. An incomplete fence, malformed JSON, additional wrapper keys, or any schema mismatch follows the normal bounded repair and fallback path.

Malformed JSON or a schema mismatch receives the one repair; if that repair is still invalid, routing records safe `invalid_response` before fallback or final exhaustion. Provider response reads and the invalid-output excerpt embedded in repair context remain bounded. Final errors expose only provider slug and safe category, never credentials, user input, raw model output, upstream bodies, or validation internals. Offline regression coverage checks the exact Responses payload, stable schema/name reuse during repair, supported creative schema shapes, post-receipt validation and safe failure, plus a schema-enforcing creative start through an injected fake HTTP transport. These tests call no live provider.

Settings and creative routes share one lazy application composition: settings store, credential cipher, provider registry, structured router, typed creative agents, Hermes coordinator, and—only in live mode—one owned dispatcher. Creative generation resolves routing for the authenticated owner before each new model-backed transition. Missing routing returns `409 {"detail":{"code":"ai_configuration_required"}}`. Exhausted configured routes return `503` with `detail.code` `all_providers_failed` and ordered safe `attempts` containing only `provider_slug` and `category`.

`LLM_TRANSPORT_MODE=test` replaces both provider operations and structured creative generation with deterministic typed offline implementations. It creates no dispatcher or HTTP client. Live composition shares one dispatcher between settings operations and structured routing and closes it once during application shutdown.

## Shared response shapes

`CreativeSession` returned by `/start`, `/reject`, and `/approve`:

```json
{
  "session_id": "uuid",
  "brand_name": "Northstar Coffee",
  "description": "A premium coffee brand for busy city mornings.",
  "goal": "Get more menu photo clicks from Google Maps",
  "reference": "Warm but confident; not meme-y",
  "dna": {
    "beliefs": ["...", "...", "..."],
    "tone_sliders": [
      {"label": "Energy", "left": "Calm", "right": "Bold", "value": 55},
      {"label": "Voice", "left": "Formal", "right": "Casual", "value": 60}
    ]
  },
  "directions": [
    {
      "id": 1,
      "name": "Neighborhood Fun",
      "tone": "Warm and welcoming",
      "visual_style": "Sunlit editorial",
      "creative_intent": "Make local routine feel special",
      "palette": ["#F4C95D"],
      "channels": ["Instagram"],
      "why_it_works": "Fits neighborhood ritual."
    },
    {
      "id": 2,
      "name": "Premium Artisan",
      "tone": "Craft-led",
      "visual_style": "Minimal still life",
      "creative_intent": "Emphasize seasonal making",
      "palette": ["#22313F"],
      "channels": ["Menu"],
      "why_it_works": "Signals considered quality."
    },
    {
      "id": 3,
      "name": "Internet Chaos",
      "tone": "Playful and loud",
      "visual_style": "High-contrast collage",
      "creative_intent": "Create fast social attention",
      "palette": ["#FF4D6D"],
      "channels": ["TikTok"],
      "why_it_works": "Creates a sharp, shareable contrast."
    }
  ],
  "round": 1,
  "status": "active",
  "rejections": [],
  "constraints": [],
  "refined_direction": null,
  "artifact": null,
  "updated_at": "2026-07-22T00:00:00+00:00"
}
```

Every session response has exactly three `directions`. `Direction` is object with `id`, `name`, `tone`, `visual_style`, `creative_intent`, `palette`, `channels`, and `why_it_works`. `Artifact` is object with `caption`, SVG string `layout_mock_svg`, and three-string `rationale`.

## `POST /creative/start`

Creates session in `active` status with DNA and three directions. Returns `201 Created` plus `CreativeSession`.

```json
{
  "brand_name": "Northstar Coffee",
  "description": "A premium coffee brand for busy city mornings.",
  "goal": "Get more menu photo clicks from Google Maps",
  "reference": "Warm but confident; not meme-y"
}
```

Fields: `brand_name` required, trimmed, 1–80 characters; `description` required, trimmed, 5–280; `goal` optional null or trimmed 10–500; `reference` optional null or trimmed 1–240.

## `POST /creative/reject`

Accepts exactly two distinct existing directions in one request. Both rejections produce constraints and one refined direction; response is `CreativeSession` with `status: "refined_ready"`.

```json
{
  "session_id": "uuid",
  "rejections": [
    {"direction_id": 2, "reason": "too_loud", "note": "Feels like hype"},
    {"direction_id": 3, "reason": "not_our_audience", "note": "Too young"}
  ]
}
```

`session_id` is required non-empty trimmed string. `rejections` length is exactly 2; `direction_id` is integer at least 1 and ids must differ. `reason` is one of `too_generic`, `too_loud`, `not_our_audience`, `not_authentic`, or `other`. `note` is optional null or trimmed 1–240 characters.

## `POST /creative/approve`

Only approves a refined direction. Request:

```json
{"session_id": "uuid"}
```

Returns `CreativeSession` with `status: "approved"`. Approval cannot skip refinement. Approval is idempotent after success: retrying while already `approved` returns current session, and retrying after `executed` returns current executed session without changing it. This makes a retry safe when successful approval response was lost.

## `POST /creative/execute`

Only executes an approved direction. Request:

```json
{"session_id": "uuid"}
```

Returns `200 OK`:

```json
{
  "session_id": "uuid",
  "status": "executed",
  "artifact": {
    "caption": "...",
    "layout_mock_svg": "<svg ...>...</svg>",
    "rationale": ["...", "...", "..."]
  },
  "direction": {
    "id": 10,
    "name": "...",
    "tone": "...",
    "visual_style": "...",
    "creative_intent": "...",
    "palette": ["..."],
    "channels": ["..."],
    "why_it_works": "..."
  }
}
```

Execution is idempotent: execute after `executed` returns same persisted artifact and direction without generating another artifact.

## Lifecycle and errors

State flow is `active` → `refined_ready` → `approved` → `executed`. `/reject` only works while active; `/approve` transitions refined-ready and safely reads already approved/executed state; `/execute` works while approved or executed.

Every stored session has an internal `user_id` owner. Hermes and persistence operations require that owner for create, load, save, reject, approve, and execute; a session owned by another user—or persisted state whose embedded owner/session key is inconsistent—is indistinguishable from a missing session and is never cached or mutated. HTTP routes pass only the verified identity's user id into these operations and do not expose `user_id` in response payloads.

- `401`: bearer credentials missing, malformed, invalid, or expired. The response is always generic, includes `WWW-Authenticate: Bearer`, and never echoes the token or upstream authentication error.
- `404`: session missing.
- `409`: unknown direction, duplicate rejection direction ids, invalid lifecycle transition, or missing AI routing (`{"detail":{"code":"ai_configuration_required"}}`).
- `503`: every configured provider attempt failed. The response is `{"detail":{"code":"all_providers_failed","attempts":[{"provider_slug":"...","category":"..."}]}}`; attempts never expose credentials, provider bodies, raw exceptions, or invalid model output.
- `422`: Pydantic request validation failure, including invalid fields or rejection list length.

Start checks routing before generating or creating a session. Before reject, approve, or execute mutates a session, Hermes bypasses its cache and reloads the persisted owner-scoped state, then validates lifecycle state before new AI work. All generative transitions build a copy, generate, persist, then replace the cache; provider or persistence failure leaves the prior stored and cached state retryable. A lock serializes transitions only within one Hermes process; session persistence does not claim distributed cross-worker compare-and-swap. Approve and already-executed retries do not require a new model call.

## Versioned project graph service

Backend project domain owns project creation/listing, quick capture, typed semantic node and relationship mutations, soft trash/restore, decision approval, layout, annotations, canvas media, and theme resolution. Every `/projects/*` and `/users/me/theme` request requires the same verified bearer identity as creative/settings routes. Foreign projects, graph items, revisions, and media return the same safe `404 {"detail":"Project not found."}` response.

Routes cover project create/list/get, `GET /projects/{project_id}/summary`, and bounded `GET /projects/summaries?limit=1..100` (default 50); node create/update/trash/restore/approve; relationship create/update/delete; layout and annotation replacement; media upload/download/delete; project/global themes; and node revisions. Single summary returns authoritative semantic project version, Blueprint readiness, and unresolved challenge count. Summary-list returns project records with those status fields in deterministic project-ID order. Persistent mode calls one service-role-only transactional RPC that validates the 1–100 limit, row-locks the bounded owned project page, and aggregates complete matching nodes and terminal resolutions in the same database snapshot; it does not read edges, rely on PostgREST row pagination for nested inputs, or perform per-project/per-challenge client queries. Count includes live challenge nodes without terminal `resolved`, `deferred`, or `overridden` resolution; it never derives from canvas state or guesses around a failed read. Summaries are owner-scoped and foreign projects never appear. Project and node creation return `201`; deletes and theme writes return `204`. Semantic writes carry expected project and record versions. Stale writes return `409 {"detail":{"code":"version_conflict"}}`. Bounded strict request models require finite coordinates and validation errors omit submitted content.

`PUT /projects/{project_id}/layout` is an isolated collection CAS. Request carries
`expected_layout_version`, complete `positions` x/y pairs, and complete `dimensions` width/height
pairs. Width is bounded to 80–1200 pixels and height to 64–900 pixels; booleans, non-finite values,
unknown nodes, stale versions, and malformed pairs fail without changing either layout map. Response
returns next layout `version`. `GET /projects/{project_id}` returns `layout_version`, `layout`, and
`layout_dimensions` separately from semantic project version and annotation version.

Every semantic node or relationship mutation compares record and project versions inside one store commit and increments project semantic version. Node mutations append a full immutable revision of prior title, content, type, state, creation source, provenance, and tags in that same commit. Relationships may reference only distinct live nodes in same owned project; duplicate semantic relationships are rejected.

Layout, annotation, media, and theme writes use separate domains and never increment semantic project version or alter nodes, edges, revisions, analysis cache/dependencies, or Blueprint readiness inputs. Layout coordinates accept only finite integers/floats excluding booleans and persist as float pairs. Annotation replacement atomically validates collection CAS, owner/project scope, UUID/timestamp/type invariants, version transitions, and same-owner/project media existence. New annotations start at version 1; changed existing annotations increment exactly once with a later `updated_at`; unchanged records retain their version. Canvas media accepts only magic-byte-verified PNG, JPEG, or WebP payloads up to 5 MiB, requires declared MIME match, and stores a SHA-256 digest under an opaque UUID key. Explicit deletion rejects media still referenced by a persisted annotation; the annotation must be removed first.

Each annotation contains at most 10,000 path points, and one replacement request contains at most 50,000 path points across all annotations. A raw `mode="before"` validator counts list lengths before constructing nested point models, robustly ignoring malformed non-list/non-object shapes so normal field validation can report them. Annotation and discard collections remain capped at 500 items. Overflow returns the standard content-safe `422` and leaves annotation version/state unchanged.

A route-scoped pure ASGI middleware caps raw `PUT /projects/{project_id}/annotations` bodies at 8 MiB before FastAPI JSON/Pydantic parsing. It rejects an oversized `Content-Length` immediately. For streamed/chunked bodies, it checks each chunk against remaining capacity before appending, never buffers more than 8 MiB, and replays only the bounded body downstream. Rejection is safe `413 {"detail":{"code":"annotation_payload_too_large"}}`. This cap does not apply to media routes, which retain their separate 5 MiB streamed-content contract.

Media upload uses raw bytes with `Content-Type` and `X-Filename`. Before appending each streamed chunk, the backend verifies that it fits within the remaining 5 MiB allowance; an over-limit chunk is never copied or persisted. Spoofed/unsupported types return safe `415`; oversized input returns safe `413`. A successful upload returns media metadata plus one high-entropy `upload_claim`; only its SHA-256 hash is stored in a separate owner/project/media pending-claim record, never in `CanvasMedia`, graph responses, or logs. Annotation replacement may include bounded `discard_media_on_failure` entries shaped as `{"media_id":"uuid","upload_claim":"..."}`. Cleanup candidates are derived from the entire validated request before annotation hydration: a claim entry qualifies when its media ID appears in any requested media annotation, independent of annotation ID and list order. After any later failed save, cleanup atomically requires matching owner, project, media, claim hash, and an unreferenced media record. Missing, wrong, replayed, or previously consumed claims cannot delete media. A successful annotation commit consumes pending claims for every attached media item under the same store lock; later detachment cannot revive deletion authority. Downloads expose authorized bytes and detected MIME only. Project theme overrides global theme; `{"theme":null}` clears the override.
# Project persistence contract

Project HTTP shapes remain store-independent. `SETTINGS_STORE_MODE=memory` uses in-memory project
state. Persistent local mode uses owner/project-scoped Supabase rows and private Storage bytes.
Semantic node/edge/proposal mutations are atomic compare-and-swap operations; stale project or
item versions still map to existing `409 version_conflict` responses. Layout and annotation writes
have independent versions and cannot increment semantic project versions. Persistence SDK/database
details and raw errors never enter HTTP responses.

## Hermes graph analysis and proposal review

`POST /projects/{project_id}/analysis` accepts `selected_node_id`, bounded `analysis_type`,
`expected_project_version`, and an 8–128 character `idempotency_key`. Hermes receives only selected
semantic neighborhood nodes/edges plus compact branch summary. Canvas layout, annotations, and media
never enter request context or cache identity. Cache identity covers exact dependency content and
versions, analysis type, configured primary provider/model, prompt version, and structured schema
version. Unchanged inputs return same pending proposal with zero provider calls; disconnected graph
changes do not invalidate it. Accepted or rejected proposal lifecycle does not discard cached
analysis: when semantic dependencies remain unchanged, a new pending preview is created from the
validated cached output with zero provider calls. Analysis validates all client keys, references, affected nodes, and
types before persisting. It creates pending proposal only and never mutates graph.

Analysis idempotency keys are owner/project scoped and bound to normalized selected node, analysis
type, and expected project version. First request atomically claims key before provider work. Same
completed request replays exact validated response without provider call; reusing key for different
request, or racing an unexpired in-progress claim, returns `409 version_conflict`. Pending claims
have a bounded 60-second lease; an expired claim is atomically replaced so process death cannot
strand a key. Failed work releases claim for immediate retry. Persistent mode stores only SHA-256
claim capability, never raw token. Proposal listing
reparses strict structured output and revalidates dependency context/references; missing or corrupt
candidate persistence returns safe store-unavailable response rather than raw cached JSON.
Completed replay also revalidates requested project, affected targets, dependency maps, and canonical
candidate hash; corrupt persisted replay is rejected safely.

`GET /projects/{project_id}/proposals` returns owner-scoped proposal metadata plus validated preview
candidate. `POST /projects/{project_id}/proposals/{proposal_id}/accept` accepts
`expected_project_version`, translates candidate client keys to stable generated UUIDs, and commits
complete node/edge candidate plus accepted proposal state in one compare-and-swap transaction.
Acceptance verifies immutable canonical output/dependency hash, exact affected-node binding, and
every dependency node/edge ID and version against live graph records immediately before atomic
commit. Caller may change only state, next version, and update timestamp.
Stale acceptance returns `409 version_conflict`; repeat after success is idempotent even with stale
retry version or later dependency edits. Retry validates immutable candidate binding, returns stored
accepted records, and never reapplies graph mutations. Foreign projects/proposals remain
indistinguishable from missing records.

`POST /projects/{project_id}/challenges/{node_id}/resolve` accepts terminal state `resolved`,
`deferred`, or `overridden`, a non-empty resolution note, and `expected_project_version`. It appends
one owner-scoped immutable resolution record and advances semantic project version atomically.
Later terminal choices for same challenge return `409 version_conflict`. Missing AI
routing returns safe `409 ai_configuration_required`; provider exhaustion returns safe
`503 all_providers_failed` without provider attempts, prompts, payloads, or raw exceptions.

Blueprint routes are `GET /projects/{project_id}/blueprint/readiness`,
`POST /projects/{project_id}/blueprints`, `GET /projects/{project_id}/blueprints`, and
`GET /projects/{project_id}/blueprints/{snapshot_id}`. Compilation accepts
`expected_project_version`; stale input returns `409 version_conflict`, while repeat compilation at
the same semantic version returns the existing snapshot. Required sections are purpose, audience,
positioning, promise, personality/voice, naming, messaging, visual direction,
evidence/assumptions, unresolved challenges, and next actions. Section membership uses normalized
`section:<slug>` or slug node tags. Readiness requires a live approved decision and no unresolved
blocking challenge per section. Early compilation remains allowed and records explicit warnings and
all live assumption IDs. Snapshots persist immutable canonical JSON, semantic project version,
owner/project sequence, source node/edge IDs, and UTC creation time. Canvas layout, annotations, and
media are never read for readiness or compilation. `evidence-assumptions` deterministically
aggregates every live evidence and assumption node; `unresolved-challenges` aggregates every live
unresolved challenge, including advisory non-blocking challenges. Non-blocking challenges appear in
content but not `blocking_challenge_ids` and do not prevent readiness. Topical sections retain tag
membership. Snapshot persistence performs expected-project-version verification and same-version
idempotency atomically; a semantic mutation racing compilation returns `409 version_conflict` and
cannot persist stale canonical input. Same-version replay also always enters this atomic check; a
pre-read historical row never bypasses current semantic-version validation.
Compiler uses one ordered snapshot-history read for both same-version candidate selection and next
sequence calculation. If an exact same-version winner appears afterward, atomic persistence returns
that authoritative row even when its sequence differs; non-exact canonical/source payload is rejected.
