# API contract

Brand Constellation is sole production HTTP journey. FastAPI registers authenticated project, theme, and settings routes plus public `/health`; guided-session endpoints are not registered and normal Not Found behavior applies to removed paths.

Every `/projects/*`, `/users/me/theme`, and `/settings/*` request requires `Authorization: Bearer <access-token>`. Supabase auth verifies end-user token against configured local project and derives owner from verified user id. Verifier/client may be reused, but token results and identities are never cached. Development test mode accepts only non-empty `test-user:<id>` tokens and is forbidden with `APP_ENV=production`. `APP_ENV` accepts exactly `development`, `test`, or `production`; aliases and typos fail closed.

Public `/` serves product orientation without project data. Protected browser routes are Projects, Brand Constellation, Blueprint, and Settings. Shared authorized JSON client obtains fresh access token per attempt, attaches it, safely parses typed FastAPI errors, retries one `401`, and returns to login after final `401`. Next.js proxy refreshes Supabase cookies with `getUser()` and never authorizes from `getSession()`.

Historical session storage is outside runtime HTTP contract. No registered application route reads or mutates historical rows, calls providers for them, or converts them into project graph data.

## AI provider settings

Every `/settings/*` request requires same bearer identity as project routes. Settings are owner-scoped. Responses expose public Hermes manifest metadata, connection status, configured endpoint, test time, and final four-character mask only. They never expose API-key plaintext, ciphertext, nonce, upstream bodies, or validation input. Invalid request errors contain only safe type, location, and message fields.

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

Malformed JSON or a schema mismatch receives the one repair; if that repair is still invalid, routing records safe `invalid_response` before fallback or final exhaustion. Provider response reads and the invalid-output excerpt embedded in repair context remain bounded. Final errors expose only provider slug and safe category, never credentials, user input, raw model output, upstream bodies, or validation internals. Offline regression coverage checks the exact Responses payload, stable schema/name reuse during repair, supported graph-analysis schema shapes, post-receipt validation and safe failure, plus schema-enforcing analysis through injected fake transport. These tests call no live provider.

Settings and project analysis share one lazy application composition: settings store, credential cipher, provider registry, structured router, graph-analysis service, Blueprint compiler, and—only in live mode—one owned dispatcher. Graph analysis resolves routing for authenticated owner before model-backed work. Missing routing returns `409 {"detail":{"code":"ai_configuration_required"}}`. Exhausted configured routes return `503` with `detail.code` `all_providers_failed` and ordered safe `attempts` containing only `provider_slug` and `category`.

`LLM_TRANSPORT_MODE=test` replaces provider operations and structured graph analysis with deterministic typed offline implementations. It creates no dispatcher or HTTP client. Live composition shares one dispatcher between settings operations and structured routing and closes it once during application shutdown.


## Versioned project graph service

Backend project domain owns project creation/listing, quick capture, typed semantic node and relationship mutations, soft trash/restore, decision approval, layout, annotations, canvas media, and theme resolution. Every `/projects/*` and `/users/me/theme` request requires the same verified bearer identity as settings routes. Foreign projects, graph items, revisions, and media return the same safe `404 {"detail":"Project not found."}` response.

Theme state in `GET /projects/{project_id}` includes `theme` (effective), `global_theme` (authenticated user default), and nullable `project_theme` (project override). Effective precedence is project override, global default, then Paper. Clients keep both selectors controlled and reload these authoritative values after successful writes.

Routes cover project create/list/get, `GET /projects/{project_id}/summary`, and bounded `GET /projects/summaries?limit=1..100` (default 50); node create/update/trash/restore/approve; relationship create/update/delete; layout and annotation replacement; media upload/download/delete; project/global themes; and node revisions. Single summary returns authoritative semantic project version, Blueprint readiness, and unresolved challenge count. Summary-list returns project records with those status fields in deterministic project-ID order. Persistent mode calls one service-role-only transactional RPC that validates the 1–100 limit, row-locks the bounded owned project page, and aggregates complete matching nodes and terminal resolutions in the same database snapshot; it does not read edges, rely on PostgREST row pagination for nested inputs, or perform per-project/per-challenge client queries. Count includes live challenge nodes without terminal `resolved`, `deferred`, or `overridden` resolution; it never derives from canvas state or guesses around a failed read. Summaries are owner-scoped and foreign projects never appear. Project and node creation return `201`; deletes and theme writes return `204`. Version inputs are route-specific below. Queued semantic writes accept an 8–128 character `Idempotency-Key`. Owner/project/key/request-hash binding, applicable compare-and-swap, and stored response commit in one store lock or service-role-only database transaction, so retry after response loss returns exact result without second mutation. Stale writes and mismatched key reuse return `409 {"detail":{"code":"version_conflict"}}`. Bounded strict request models require finite coordinates and validation errors omit submitted content.

Semantic mutation routes accept optional `Idempotency-Key` header of 8–128 characters. Pending edits
always send it. Key is bound to authenticated owner, project, operation, and canonical request payload.
Exact replay returns stored result without second mutation; different request reuse returns `409
version_conflict`; failed mutation releases leased claim for retry. Memory and local Supabase reuse same
bounded leased request registry as analysis. Key never replaces optimistic concurrency: queued request
sends exact stored expected version.

`PUT /projects/{project_id}/layout` is an isolated collection CAS. Request carries
`expected_layout_version`, complete `positions` x/y pairs, and complete `dimensions` width/height
pairs. Width is bounded to 80–1200 pixels and height to 64–900 pixels; booleans, non-finite values,
unknown nodes, stale versions, and malformed pairs fail without changing either layout map. Response
returns next layout `version`. `GET /projects/{project_id}` returns `layout_version`, `layout`, and
`layout_dimensions` separately from semantic project version and annotation version.

Node and relationship version rules are exact: create-node and create-edge compare `expected_project_version`; node update/trash/restore compare both `expected_node_version` and `expected_project_version`; edge update/delete compare both `expected_edge_version` and `expected_project_version`. Each successful operation atomically advances project semantic version. Node update/trash/restore append full immutable prior revision. Decision approval is the exception: `VersionRequest.expected_node_version` only; service loads current owned project and atomically advances the current project version while approving and revising the decision. Relationships may reference only distinct live nodes in same owned project; duplicate semantic relationships are rejected. Changing an approved decision's title, content, tags, state, or node type atomically marks each direct live semantic dependent `review_suggested`, increments that dependent exactly once, and stores its prior revision. Trashing such a foundation retains existing relationships as lineage; other nodes with incident relationships still reject trash.

Layout, annotation, media, and theme writes use separate domains and never increment semantic project version or alter nodes, edges, revisions, analysis cache/dependencies, or Blueprint readiness inputs. Layout compares `expected_layout_version`; annotations compare `expected_annotation_version`; media routes expose no optimistic-version input. Project theme write verifies ownership, then stores `paper|graphite|project|null` without project-version CAS; null clears override. Global theme writes update the authenticated user preference only, require non-null `paper|graphite|project`, use no project/version input, and affect effective theme only for projects without override. Layout coordinates accept only finite integers/floats excluding booleans and persist as float pairs. Annotation replacement atomically validates collection CAS, owner/project scope, UUID/timestamp/type invariants, version transitions, and same-owner/project media existence. New annotations start at version 1; changed existing annotations increment exactly once with a later `updated_at`; unchanged records retain their version. Canvas media accepts only magic-byte-verified PNG, JPEG, or WebP payloads up to 5 MiB, requires declared MIME match, and stores a SHA-256 digest under an opaque UUID key. Explicit deletion rejects media still referenced by a persisted annotation; annotation must be removed first.

Each annotation contains at most 10,000 path points, and one replacement request contains at most 50,000 path points across all annotations. A raw `mode="before"` validator counts list lengths before constructing nested point models, robustly ignoring malformed non-list/non-object shapes so normal field validation can report them. Annotation and discard collections remain capped at 500 items. Overflow returns the standard content-safe `422` and leaves annotation version/state unchanged.

A route-scoped pure ASGI middleware caps raw `PUT /projects/{project_id}/annotations` bodies at 8 MiB before FastAPI JSON/Pydantic parsing. It rejects an oversized `Content-Length` immediately. For streamed/chunked bodies, it checks each chunk against remaining capacity before appending, never buffers more than 8 MiB, and replays only the bounded body downstream. Rejection is safe `413 {"detail":{"code":"annotation_payload_too_large"}}`. This cap does not apply to media routes, which retain their separate 5 MiB streamed-content contract.

Media upload uses raw bytes with `Content-Type` and `X-Filename`. Before appending each streamed chunk, the backend verifies that it fits within the remaining 5 MiB allowance; an over-limit chunk is never copied or persisted. Spoofed/unsupported types return safe `415`; oversized input returns safe `413`. A successful upload returns media metadata plus one high-entropy `upload_claim`; only its SHA-256 hash is stored in a separate owner/project/media pending-claim record, never in `CanvasMedia`, graph responses, or logs. Annotation replacement may include bounded `discard_media_on_failure` entries shaped as `{"media_id":"uuid","upload_claim":"..."}`. Cleanup candidates are derived from the entire validated request before annotation hydration: a claim entry qualifies when its media ID appears in any requested media annotation, independent of annotation ID and list order. After any later failed save, cleanup atomically requires matching owner, project, media, claim hash, and an unreferenced media record. Missing, wrong, replayed, or previously consumed claims cannot delete media. A successful annotation commit consumes pending claims for every attached media item under the same store lock; later detachment cannot revive deletion authority. Downloads expose authorized bytes and detected MIME only. Project theme overrides global theme; `{"theme":null}` clears the override.
# Project persistence contract

Project HTTP shapes remain store-independent. `SETTINGS_STORE_MODE=memory` uses in-memory project
state. Persistent local mode uses owner/project-scoped Supabase rows and private Storage bytes.
Node/edge mutations and proposal acceptance use route-specific compare-and-swap inputs; stale applicable project or
item versions map to existing `409 version_conflict` responses. Proposal rejection is separate terminal transition. Layout and annotation writes
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
Challenge dependency entries use one canonical proposal scheme: each entry must be a distinct relevant
context node ID or another proposed node's `client_key`, and may not reference the challenge itself.
Unknown, duplicate, and self dependencies reject provider output before proposal persistence.
Acceptance translates proposed keys to generated node IDs, so stored metadata contains only graph IDs.

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

`POST /projects/{project_id}/challenges/{node_id}/resolve` accepts nonterminal `acknowledged` or terminal `resolved`, `deferred`, or `overridden`, a non-empty note, and `expected_project_version`. It appends one owner-scoped immutable transition record and advances semantic project version atomically. One acknowledgement may precede one terminal choice; duplicate or later contradictory transitions return `409 version_conflict`. Missing AI
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
owner/project sequence, project title captured at compilation, source node/edge IDs, and UTC creation
time. `project_title` is stored beside and must exactly match canonical JSON; API history never joins
a later live project title. Canvas layout, annotations, and
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
### Proposal rejection and challenge history

`POST /projects/{project_id}/proposals/{proposal_id}/reject` performs owner-scoped atomic
`pending -> rejected` transition. Repeated rejection returns same terminal record; accepted proposal
returns `version_conflict`. Rejection never changes project semantic version or graph. Proposal lists
return pending review items only. Proposal rejection accepts no version body: it succeeds only for exact
owned pending proposal, replays exact rejected proposal idempotently, and rejects accepted terminal state.

`GET /projects/{project_id}/challenges/{node_id}/resolutions` returns owner-scoped immutable acknowledgement and terminal transition records for an existing node even when a resolved challenge was later converted to another
type. Creating a new resolution still requires a live challenge. Hermes challenge candidates require structured dependency identifiers,
confidence from 0 through 100, and downstream effect. Accepted challenge nodes preserve these fields
through ordinary semantic edits and copy them into prior revisions. Changing a challenge to another
node type clears challenge-only metadata; manually changing another type into a challenge starts with
empty dependencies and unstated confidence/downstream effect.

## Canonical project HTTP inventory

Every route requires bearer authentication and owner scope:

```text
POST /projects
GET /projects
GET /projects/summaries
GET /projects/{project_id}
GET /projects/{project_id}/summary
POST /projects/{project_id}/nodes
PATCH /projects/{project_id}/nodes/{node_id}
POST /projects/{project_id}/nodes/{node_id}/trash
POST /projects/{project_id}/nodes/{node_id}/restore
POST /projects/{project_id}/nodes/{node_id}/approve
POST /projects/{project_id}/edges
PATCH /projects/{project_id}/edges/{edge_id}
DELETE /projects/{project_id}/edges/{edge_id}
PUT /projects/{project_id}/layout
PUT /projects/{project_id}/annotations
POST /projects/{project_id}/media
GET /projects/{project_id}/media/{media_id}
DELETE /projects/{project_id}/media/{media_id}
PUT /projects/{project_id}/theme
PUT /users/me/theme
GET /projects/{project_id}/revisions/{node_id}
POST /projects/{project_id}/analysis
GET /projects/{project_id}/proposals
POST /projects/{project_id}/proposals/{proposal_id}/accept
POST /projects/{project_id}/proposals/{proposal_id}/reject
POST /projects/{project_id}/challenges/{node_id}/resolve
GET /projects/{project_id}/challenges/{node_id}/resolutions
GET /projects/{project_id}/blueprint/readiness
POST /projects/{project_id}/blueprints
GET /projects/{project_id}/blueprints
GET /projects/{project_id}/blueprints/{snapshot_id}
```

All project JSON models are strict; unknown fields rejected, coercion disabled, and strings trimmed where constrained. Shared primitives: `ShortText` is 1–240 characters; `BoundedText` is 1–4000; `expected_project_version`: integer `>= 0` when present; `NonNegativeVersion` is strict; UUID text is exactly 36 characters matching UUID versions 1–5; timestamps are 20–64-character ISO-like UTC values. Path/query IDs remain route strings and ownership checks hide foreign records.

### Request models

- `ProjectCreate`: `title: ShortText`.
- `NodeCreate`: `node_type: evidence|assumption|idea|decision|challenge|output`; `title: ShortText`; `content: BoundedText`; `created_by: user|hermes|import`; optional `provenance: string|null` max 500; `tags: ShortText[]` default `[]`, max 24; `expected_project_version: integer >= 0`. Reserved workspace tags are validated: `section:<approved-blueprint-slug>`, `branch:<safe-slug>`, `cluster:<safe-slug>`, and `palette:<comma-separated-6-digit-hex-values>`. Hermes proposals inherit section/branch/cluster scope from affected semantic nodes; decorative or unvalidated tags never propagate automatically.
- `NodeUpdate`: every `NodeCreate` field plus `state: working|approved|review_suggested|trash` and `expected_node_version: integer >= 0`.
- `VersionRequest`: `expected_node_version: integer >= 0`. `NodeMutationVersionRequest` adds `expected_project_version: integer >= 0`.
- `EdgeCreate`: `source_node_id`, `target_node_id` as `ShortText`; `edge_type: supports|contradicts|depends_on|inspires|supersedes`; optional `label: ShortText|null`; `expected_project_version: integer >= 0`.
- `EdgeUpdate`: edge type/optional label plus `expected_edge_version` and `expected_project_version`, both strict integer `>= 0`.
- `EdgeDelete`: `expected_edge_version` and `expected_project_version`, strict integer `>= 0`. This is a JSON DELETE request body, not query parameters.
- `LayoutRequest`: `expected_layout_version: integer >= 0`; complete `positions` and `dimensions` objects, each max 2000 keys, each key `ShortText`, each value exactly two strict finite numbers. Service additionally requires known nodes and dimensions width 80–1200, height 64–900.
- `AnnotationRequest`: optional UUID `id`; required `annotation_type: freehand|media`; `path_points` default `[]`, max 10,000 exact numeric pairs; optional color 1–64 characters; optional UUID `media_id`; optional integer `version >= 1`; optional bounded timestamps; supplied project/owner fields are accepted only as bounded input and server replaces them with authenticated scope. Freehand requires at least two points/no media; media requires only media reference.
- `MediaDiscardClaim`: UUID `media_id`; `upload_claim` 20–200 characters. `AnnotationsRequest`: `expected_annotation_version >= 0`; `annotations` max 500; `discard_media_on_failure` default `[]`, max 500; aggregate path cap 50,000 and raw route body cap 8 MiB.
- `ThemeRequest`: `theme: paper|graphite|project|null`; null allowed only for project override clearing.
- `AnalysisRequest`: `selected_node_id: ShortText`; `analysis_type` 1–64 characters; `expected_project_version >= 0`; body `idempotency_key` 8–128 characters.
- `ProjectVersionRequest`: `expected_project_version: integer >= 0`.
- `ChallengeResolutionRequest`: `ProjectVersionRequest` plus `state: resolved|deferred|overridden` and `resolution: BoundedText`.

### Route/status/shape matrix

Every row requires `Authorization: Bearer`. `Idempotency-Key` header is optional, trimmed 8–128 characters, on node create/update/trash/restore/approve, edge create/update/delete, proposal accept/reject, and challenge resolve; it is independent from analysis body's required `idempotency_key`.

Challenge transition accepts `acknowledged|resolved|deferred|overridden`. `acknowledged` is persisted, versioned, visible in history, and remains nonterminal for unresolved counts and Blueprint blocking. Exactly one acknowledgement may precede exactly one terminal resolution; terminal state remains immutable.

| Method/path | Input | Success |
| --- | --- | --- |
| `POST /projects` | `ProjectCreate` | `201`; Project object |
| `GET /projects` | query `limit`: default `50`; range `1..100` | `200`; ordered Project array |
| `GET /projects/summaries` | query `limit`: default `50`; range `1..100` | `200`; summary array with Project fields, semantic version, readiness, unresolved challenge count |
| `GET /projects/{project_id}` | none | `200`; `{project,nodes,edges,layout,layout_dimensions,layout_version,annotations,annotation_version,theme,global_theme,project_theme}` |
| `GET /projects/{project_id}/summary` | none | `200`; one authoritative project summary |
| `POST /projects/{project_id}/nodes` | `NodeCreate`; optional idempotency header | `201`; GraphNode |
| `PATCH /projects/{project_id}/nodes/{node_id}` | `NodeUpdate`; optional idempotency header | `200`; incremented GraphNode |
| `POST /projects/{project_id}/nodes/{node_id}/trash` | `NodeMutationVersionRequest`; optional idempotency header | `200`; trashed GraphNode |
| `POST /projects/{project_id}/nodes/{node_id}/restore` | `NodeMutationVersionRequest`; optional idempotency header | `200`; restored GraphNode |
| `POST /projects/{project_id}/nodes/{node_id}/approve` | `VersionRequest`; optional idempotency header | `200`; approved decision GraphNode; project version advances in service |
| `POST /projects/{project_id}/edges` | `EdgeCreate`; optional idempotency header | `201`; GraphEdge |
| `PATCH /projects/{project_id}/edges/{edge_id}` | `EdgeUpdate`; optional idempotency header | `200`; incremented GraphEdge |
| `DELETE /projects/{project_id}/edges/{edge_id}` | `EdgeDelete` JSON DELETE request body; optional idempotency header | `204`; empty body |
| `PUT /projects/{project_id}/layout` | `LayoutRequest` | `200`; `{"version": next_layout_version}` |
| `PUT /projects/{project_id}/annotations` | `AnnotationsRequest` | `200`; `{"version": next_annotation_version}` |
| `POST /projects/{project_id}/media` | raw body max 5 MiB; required matching `Content-Type` PNG/JPEG/WebP; `X-Filename` read as untrusted display input | `201`; CanvasMedia metadata plus one plaintext `upload_claim` returned once |
| `GET /projects/{project_id}/media/{media_id}` | none | `200`; authorized raw bytes with detected media type |
| `DELETE /projects/{project_id}/media/{media_id}` | no body | `204`; empty body; referenced media yields `409 media_in_use` |
| `PUT /projects/{project_id}/theme` | `ThemeRequest`, including null clear | `204`; empty body |
| `PUT /users/me/theme` | `ThemeRequest`, non-null | `204`; empty body; null is `422` |
| `GET /projects/{project_id}/revisions/{node_id}` | none | `200`; deterministic immutable NodeRevision array |
| `POST /projects/{project_id}/analysis` | `AnalysisRequest` | `200`; validated proposal DTO/replay; graph unchanged |
| `GET /projects/{project_id}/proposals` | none | `200`; pending proposal DTO array with validated candidate preview |
| `POST /projects/{project_id}/proposals/{proposal_id}/accept` | `ProjectVersionRequest`; optional idempotency header | `200`; terminal accepted proposal/candidate result; graph changes atomically |
| `POST /projects/{project_id}/proposals/{proposal_id}/reject` | no body; optional idempotency header | `200`; terminal rejected proposal; graph/version unchanged |
| `POST /projects/{project_id}/challenges/{node_id}/resolve` | `ChallengeResolutionRequest`; optional idempotency header | `200`; immutable ChallengeResolution; project version advances |
| `GET /projects/{project_id}/challenges/{node_id}/resolutions` | none | `200`; immutable resolution array |
| `GET /projects/{project_id}/blueprint/readiness` | none | `200`; readiness object with section readiness, warnings, unresolved assumptions/challenges |
| `POST /projects/{project_id}/blueprints` | `ProjectVersionRequest` | `201`; immutable snapshot shape described below; same-version response remains authoritative |
| `POST /projects/{project_id}/branches/promote` | `{branch_id, expected_project_version, decisions:[{node_id,expected_node_version}]}` | `200`; atomically approves the exact complete live working-decision set for that branch, revises each node, and increments project version once; stale, foreign, incomplete, duplicate, or invalid candidates change nothing |
| `GET /projects/{project_id}/blueprints` | none | `200`; ordered immutable snapshot array |
| `GET /projects/{project_id}/blueprints/{snapshot_id}` | none | `200`; one immutable snapshot |

Project/GraphNode/GraphEdge/NodeRevision/ChallengeResolution fields serialize dataclasses and enum values as JSON strings. Snapshot response removes stored `canonical_json`, exposes its `sections`, and retains snapshot `id`, owner/project identity, captured `project_title`, `project_version`, `sequence`, source node/edge IDs, unresolved assumption IDs, warnings, record `version`, and timestamps. Analysis/proposal responses retain persisted IDs/state/version, rationale/summary, canonical validated candidate and dependency bindings; no provider prompt or raw output is exposed.

Validation is content-safe `422`. Raw annotations over 8 MiB return `413 annotation_payload_too_large`; media over 5 MiB returns `413 media_too_large`; unsupported/spoofed media returns `415 invalid_media_type`. Owner-safe missing is `404`. CAS/idempotency mismatch is `409 version_conflict`. Missing AI route is `409 ai_configuration_required`; provider exhaustion and store failure are `503 all_providers_failed` and `503 project_store_unavailable`. All response detail codes are nested under FastAPI `detail`.

Project records contain `id`, `owner_id`, title, status, theme, semantic `version`, and timestamps. Graph response contains project, nodes, edges, independently versioned layout/annotations, and effective theme. Node types are evidence, assumption, idea, decision, challenge, output. States are working, approved, review_suggested, trash. Relationships are supports, contradicts, depends_on, inspires, supersedes. Versioned mutation inputs are defined per matrix/model above; no blanket project-plus-record rule applies. Layout request is `{expected_layout_version,positions,dimensions}`. Annotation replacement is `{expected_annotation_version,annotations,discard_media_on_failure}`. Canvas/theme writes never change semantic version.

Analysis request is `{selected_node_id,analysis_type,expected_project_version,idempotency_key}`. Cache fingerprint binds relevant node/edge versions, deterministic semantic hash, analysis type, provider/model, prompt version, and schema version. Layout, annotations, and media are excluded. Cache hit makes zero provider calls. Suggestions stay pending previews. Accept uses `{expected_project_version}` and atomically applies whole canonical candidate plus terminal proposal state. Reject is terminal, idempotent, and semantic-version neutral. Challenge transition is `{state: acknowledged|resolved|deferred|overridden,resolution,expected_project_version}`; acknowledgement remains open, override requires client rationale, and one immutable terminal record exists per challenge.

Blueprint creation uses `{expected_project_version, request_id}` with a client-generated UUID. Server atomically stores an owner/project-scoped pending compilation request containing the immutable canonical semantic candidate before final publication. Retrying the same request ID publishes that exact stored candidate even when the live graph has advanced; reusing it with another version conflicts. Pending requests expire after 24 hours and are cleaned on request access. Compilation inputs contain only the captured project, semantic nodes/edges, and terminal challenge state; layout, annotations, and media are never stored in the request or snapshot. Response contains immutable snapshot ID, project title/version, sequence, UTC creation time, canonical sections, warnings, unresolved assumption IDs, and semantic source IDs.

Optional `Idempotency-Key` is 8–128 characters on queued semantic writes. Owner/project/key/request hash and exact result commit atomically. Same request replays exact result; changed request under same key conflicts. Client recovery stores at most 25 records per owner/project, each at most 64 KiB measured as UTF-8. It excludes secrets, tokens, prompts, credentials, and raw provider content. Replay is ordered, clears only after success, and stops on conflict or failure. Terminal work never replays automatically: user may discard or move it to held terminal in-memory review; held terminal work keeps close warning while reconnect remains inert.

Safe project errors: generic `401`; `404 {"detail":"Project not found."}`; `409 {"detail":{"code":"version_conflict"}}`; `409 ai_configuration_required`; `409 media_in_use`; `413` oversized media/body; `415` unsupported/spoofed media; `422 invalid_project_request` or invalid idempotency key; `503 all_providers_failed` or `project_store_unavailable`. Validation never echoes submitted content. Compare is read-only, Keep mine requires confirmation plus fresh key/version, and Accept latest replaces local draft while retaining viewport.
