# Client flow — Brand Constellation, Blueprint, and legacy sessions

## Brand Constellation appearance

Authenticated users can set Paper, Graphite, or Project as global default from project toolbar and can apply or clear project override. Effective precedence is project override, global default, then Paper. Project theme uses approved accessible palette decisions only for presentation accents and never rewrites graph values. Switching themes preserves canvas state, geometry, status wording, focus order, drafts, and semantic graph state. Reduced-motion preference removes nonessential panel, proposal, node, focus, and Blueprint transitions; React Flow drag/resize and direct drawing remain unmodified.

Theme control is a non-modal disclosure. Opening moves focus to project appearance; Escape, explicit Close, or outside activation dismisses it, and keyboard dismissal returns focus to Theme. Global and project selectors remain controlled by authoritative loaded values, so failed writes cannot display an unsaved preference.

`/` is authenticated and redirects to `/projects`, the primary project home. `/projects/new` is the adaptive diagnostic; `/settings` remains the protected AI provider and routing workspace. Project routes preserve owner isolation. Legacy Guided Workspace code remains available during rollout and is not used to infer Brand Constellation evidence or relationships.

## Projects and adaptive diagnostic

Projects home loads one bounded page of at most 50 authenticated-owner summaries in one HTTP request; it never issues one status request per project. Each compact row shows project title, update time, authoritative Blueprint readiness, unresolved challenge count excluding resolved/deferred/overridden challenges, and one Open action. If batch loading fails, no partial or fabricated rows render: page reports unavailable Projects and offers Retry. Empty state explains first step and links directly to project creation. A spatially separate Legacy sessions archive lists only authenticated owner's earlier guided sessions. It reports loading until that owner's request succeeds, never substitutes an empty result for pending or failed retrieval, and offers an explicit retry after failure. `/projects/legacy/{sessionId}` renders saved DNA, directions, refinement, and artifact read-only, without approve/reject/refine/execute or inferred graph relationships. Desktop and mobile account navigation exposes Projects, current project when one was most recently created, Settings, legacy workspace, and spatially separated sign-out.

Adaptive diagnostic waits for authenticated identity before mounting fields. Its user-keyed form reads the scoped local draft synchronously in the initial client-state initializer, so no late effect can overwrite typing; loading state exposes no prematurely editable form. It collects working project name, intent, known facts, assumptions, constraints, desired outcomes, and open questions. Only project name is required. Nonempty trimmed answers may seed at most 12 nodes total, and each answer/line is capped at 500 characters. Accessible validation runs before project creation; over-limit diagnostics create neither project nor nodes. User may skip diagnostic, save and return, or submit partial answers; empty answers remain empty and are never inferred. Draft persists locally under authenticated user identity. Submission first creates owner-scoped project, then converts each supplied line into typed semantic node with `user` creation source and explicit `Adaptive diagnostic — user supplied` provenance. Facts and constraints become evidence; stated assumptions and open questions become assumptions; intent and desired outcomes become ideas.

Diagnostic seeds receive a validated initial Blueprint section and completion recommends the first useful workspace area. Inspector exposes typed Blueprint section, branch, cluster, and accessible visual-palette metadata; it normalizes structural names to safe slugs and preserves unrelated semantic tags. Approved visual-direction palette decisions may feed Project theme accent selection without changing semantic content. Hermes-created nodes inherit validated section/branch/cluster scope from affected nodes.

If project creation fails, local draft remains and retry is available. If later node seeding fails, project is not rolled back: client removes already-sent entries from recovery state, retains only unsent entries under user/new and user/project recovery keys, names created project in alert, and links directly to it. Same test/local account recovers project list after logout/login; different owner sees neither list row nor graph.

## Authentication

Unauthenticated visits to `/`, `/projects`, `/projects/new`, and `/settings` redirect to `/login` with an encoded same-origin `next` destination. Login supports email/password sign-in and sign-up through Supabase SSR. Only relative paths beginning with one `/` are accepted as intended destinations; absolute and protocol-relative values return to `/`. Sign-out clears the session and returns to login. Auth state survives refresh through cookies, while workspace drafts retain their existing React-only lifetime.

Local Auth sign-up auto-confirms email and requires at least eight password characters. Same local account recovers its encrypted provider metadata, routing, and read-only legacy session archive after logout/login; another account remains isolated.

The form uses visible labels, email/current-or-new-password autocomplete, blur validation, generic credential errors, pending controls, an accessible password reveal, and alert/live semantics. Invalid sign-in preserves email, clears password, and returns focus to the password field. Missing auth configuration produces a stable accessible recovery message instead of leaving the form silently disabled. Failed sign-out keeps the current page and authenticated UI in place, reports a recoverable alert beside the control, and redirects only after confirmed success.

Playwright uses a guarded deterministic auth client only when `NEXT_PUBLIC_AUTH_MODE=test` and the build is not production. It stores `test-user:<stable-id>` in a same-site path cookie, accepts only the fixed test password, restores the same identity for the same normalized email, and creates no Supabase client or network request. Production ignores test mode.

## AI provider settings

Settings loads the authenticated owner's Hermes-compatible provider catalog and routing together. A labeled case-insensitive filter matches provider display name or slug while preserving manifest order, announces result count, and offers clear recovery for no matches. Providers appear as flat rows with explicit `Not connected`, `Connected`, or `Needs attention` text plus their primary/fallback model use or `Not used in routing`. Disconnected rows expose one Connect action; saved and attention-needed rows expose one Manage action. Expanded management contains replacement-key controls and a spatially separated Disconnect action. Inline editor uses a labeled password field, reveal control, model entry, and supported endpoint override. API keys remain only in React state until submitted: connection testing is transient, Save becomes available only after successful test, backend revalidates during save, failed save preserves draft for correction, and raw key is cleared and never redisplayed after success. Model discovery runs after successful test and supplies suggestions without preventing valid manual entry.

Saved rows show only final four-character suffix and public connection metadata. Disconnect uses inline confirmation, moves focus to confirmation, and returns focus to trigger when cancelled. While deletion is pending, confirmation, cancellation, close, reveal, and draft controls remain disabled so user cannot hide confirmation or erase in-flight context; there is no misleading client-side cancellation. Failed disconnect re-enables controls and retains replacement draft for recovery, while successful disconnect clears every transient secret/model field before returning to disconnected state. Providers referenced by routing show direct recovery instead of being removed. Settings survive logout and login for same account, while another account cannot see connection metadata.

Routing selects one connected primary provider and manual model, plus up to five ordered fallbacks. Every fallback can be added, removed, or moved with labeled keyboard-operable buttons. Save remains unavailable until primary and every fallback reference a currently connected provider and contain a model. Exact normalized provider/model pairs must be unique among fallbacks and cannot repeat primary; same provider with a different model remains valid. If a routed provider later needs attention or disconnects, its current unavailable selection remains visible but cannot be newly selected; primary selector stays available so owner can choose `No primary provider`, save empty route, then disconnect last credential. A new meaningless empty save stays unavailable. Saving uses loaded optimistic version. A stale write reloads latest routing and announces recovery instead of overwriting another change.

Settings requests use a fresh current access token and `Authorization: Bearer`. One `401` retries once after normal auth-client session read/refresh behavior; final `401` returns to login with safe same-origin Settings destination. FastAPI errors become concise recovery text and never render submitted keys.

During generation, routing tries primary first, then each configured fallback in displayed order. Authentication/decryption failures mark only exact credential version as `Needs attention`; timeout, rate-limit, unavailable, invalid-response, and configuration failures remain typed safe categories. Missing routing opens Settings recovery; total exhaustion preserves prior workspace state for retry.

## Legacy Guided Workspace shell

This section documents historical campaign-session behavior only. Brand Constellation is primary. One protected route-group layout owns account navigation and legacy shared React workspace provider; sign-out is spatially separated. Provider stays mounted during client-side legacy navigation, so an unsaved legacy draft survives a Settings visit. Refresh clears that React-only legacy draft.

Inside Workspace, **Brief**, **DNA**, and **Outputs** share session, Brief draft, rejection drafts, request epoch, busy state, and API error status. Before a session begins, only Brief is unlocked; creating one unlocks DNA and Outputs. Navigation does not refetch or replace shared state. Desktop uses a persistent flat side navigation. Mobile uses one overlay drawer with contained focus, opener restoration, and the top-level destinations available inside the same trap. While the drawer is modal, the main-content skip link is inert, hidden from accessibility navigation, and removed from tab order; closing restores it. Mobile sign-out closes the drawer and restores the opener before authentication completes, so a failed resolved or thrown sign-out exposes its recovery alert outside the inert region and leaves the workspace usable. A skip link reaches main content whenever no modal is open.

## Legacy Brief

Brief collects required brand name and one-sentence description, plus optional goal and reference. Submit sends `POST /api/creative/start`. Once created, Brief becomes read-only summary; **Start over** clears current session, output, Brief fields, rejection drafts, local error, and pending-operation state, then returns to empty editable Brief. A request epoch prevents delayed responses from restoring discarded browser state.

## Legacy DNA

DNA is read-only. It presents three Hermes-generated beliefs and two visual tone meters. It is hypothesis for current creative round, not user-editable brand profile.

## Legacy Outputs

Outputs first shows three direction cards: tone, visual language, creative intent, why it works, palette, and channels. User selects exactly two cards to reject, chooses structured reason for each, and may add note. Client prevents submitting any count other than two; request goes to `POST /api/creative/reject`.

Backend then returns constraints and refined survivor. Outputs shows refined card and its carried-forward constraints. **Approve and generate artifact** sends approve, then execute. If execute fails after approval, UI stays in approved state and offers **Generate artifact** retry; retry calls execute only and does not approve again. Execute is backend-idempotent.

Completed output shows caption, three-point rationale, and SVG layout mock. The deterministic renderer wraps normal copy and unbroken generated tokens inside the layout while preserving the complete text. SVG is encoded as `data:image/svg+xml` and rendered with Next `Image`; client does not inject live HTML.

## Legacy errors and local state

Client shows service and validation errors in shared live status area. Network failures use an actionable service-unavailable message. A typed `ai_configuration_required` error includes direct **Open Settings** recovery; a `404` includes direct **Start over** recovery. Failed start preserves typed Brief input. Failed rejection preserves selected rejection drafts, reasons, and notes. Lost approval responses can retry the combined action safely because approval is idempotent. Workspace provider owns session and all drafts, so navigation between views and protected destinations preserves both. Refresh loses all React-only session and drafts; this is accepted current behavior.

On mobile, primary navigation is a modal dialog while open: background is inert, focus enters and stays inside drawer, and Escape, backdrop, or a navigation choice closes it and restores focus to menu control. Resizing to desktop clears mobile overlay state.

## Deliberate MVP omissions

No autonomous external research, realtime collaboration, background workers, finished logo library, campaign generation in new graph, public Blueprint sharing, slides, DOCX, editable design exports, proprietary graph engine, or remote Supabase setup. Authentication persists account access, owner-scoped AI settings, projects, snapshots, and legacy sessions. Earlier sessions recover only as read-only legacy presentations; active legacy draft hydration remains out of scope.

## Brand Constellation Hermes contract

Guided graph analysis is scoped to selected node and relevant semantic neighborhood. Layout,
freehand annotations, and media never enter Hermes context. Suggestions appear as pending proposal
previews and cannot alter approved graph state until user explicitly accepts. Acceptance applies
whole candidate atomically under loaded project version; stale reviews preserve preview and require
reload/compare. Repeated successful acceptance is safe. Challenges retain explicit resolved,
deferred, or intentionally overridden decision records; overrides require recorded rationale.

Client project state keeps semantic nodes and edges, canvas layout, annotations, selection and
viewport, and proposal previews in separate typed slices. Quick capture is local and model-free.
Semantic and annotation undo histories are independently bounded; annotation actions cannot receive
or return semantic records. Media display uses the shared authenticated retry/login flow, rejects
responses above 5 MiB, and owns a disposable temporary object URL that is revoked on replacement or
unmount; it never uses a public storage URL. Paper and Graphite use fixed accessible interface
tokens. Project theme keeps the same neutral chrome and derives only a contrast-safe accent. It
retains approved palette values unchanged as source data; it
falls back to Paper until an approved visual-palette decision exists.

## Brand Constellation canvas

`/projects/[projectId]` loads the authenticated owner’s graph into a controlled React Flow
workbench. Semantic nodes and relationships remain separate from canvas positions, viewport,
freehand annotations, and media references. Node bodies are read-only draggable surfaces;
editing belongs to the separate work-panel inspector. Inspector saves semantic fields against
loaded versions and shows connections, creation source, provenance, and revision history. Relationship
nodes, edges, viewport controls, minimap, and mode controls remain keyboard focusable. A structured
keyboard graph panel provides labelled source/target connection and bounded width/height resize
commands equivalent to pointer handles. Toolbar, viewport, handle, and resize hit areas provide at
least 44 by 44 CSS pixels without enlarging their restrained visual marks.

Desktop tools expose Select, Connect, Draw, Erase, Add thought, and Add media modes with visible
selected state, shortcuts, and 44-pixel targets. Freehand points are converted in graph space and
rendered in a viewport-synchronized sibling SVG. Media uploads use the bounded authenticated
project endpoint, annotations retain only `media_id`, and owned object URLs are revoked after use.
Failed upload or annotation persistence reports `Annotations need attention` and retains the
selected File for an explicit in-tab retry. Failed annotation persistence removes the newly
uploaded object; failed cleanup exposes a separate retry-cleanup action and never claims the
annotation was saved. Annotation undo/redo and saves
never enter semantic graph history; layout autosave is batched independently and never invokes
Hermes. Layout saves persist position and bounded width/height atomically under loaded layout
version. Save state reports saved, saving, or needs-attention outcomes independently for semantic
graph, layout, and annotations; one domain failure never masquerades as another domain’s success.

Semantic creation and connection requests run through one project mutation queue and consume the
latest authoritative project/item versions. Optimistic nodes or edges roll back on failure with an
actionable retained draft/reconnect message. Graph undo persists node trash or edge deletion; redo
persists node restore or edge recreation. Browser-scoped command history survives reload so each
successful undo/redo reloads to the same server state. It is interaction history, not a substitute
for durable node revision history. This browser history is capped at 50 strictly validated commands
for the current project. Invalid, cross-project, or malformed records are discarded. If browser
storage is unavailable or full, server mutations remain successful and authoritative, undo/redo
continues for the current tab, and the client reports the reduced durability without changing the
graph save result.

Project map filtering covers node type, unresolved work, named `cluster:` and `branch:` tags,
selection fitting, and the minimap. Viewport is restored locally only from an exact finite bounded
`x`, `y`, and `zoom` record. Malformed values and browser storage denial are ignored safely while
mount and movement continue. Semantic graph, layout, and annotations reload from owner-scoped
project persistence. Desktop can switch between spatial canvas and a first-class structured graph
without changing selection or graph state. Structured graph lists each node's type and state in
words, exposes labeled relationships, and reuses same create, connect, select, move, edit, Hermes,
proposal, and challenge mutations as canvas. Keyboard actions announce selection, movement, and
relationship creation; returning to canvas retains graph and inspector selection.

At 640 pixels and below, desktop canvas and precision drawing/arrangement controls are replaced by
focused graph navigator. Overview exposes every node with explicit type/state, while focused card
provides cyclic Previous/Next traversal and labeled neighbor links under automatic layout. Overview,
traversal, and neighbor activation announce focused title, type, position, and neighbor count, then
move programmatic focus to focused-node heading. Desktop/structured/mobile representation changes
preserve semantic state and selection; switching back to desktop restores focus to selected canvas
node. Reactivating current overview node and one-node Previous/Next traversal still replace live-region
message content and restore heading focus, so each explicit action receives fresh feedback. Quick
capture, guided analysis, inspector editing/connection, proposal review, complete challenge
resolution, theme controls, and Blueprint access remain available below navigator. Controls retain
44-pixel targets, visible focus, reduced-motion behavior, and no page-level horizontal overflow.

Quick capture accepts evidence, assumptions, ideas, concerns, and decisions without calling a
provider. Local typed previews persist against latest loaded project version; failure removes
optimistic graph content while retaining exact form draft for retry. Selecting one node opens
inspector and guided exploration without disabling canvas. Hermes requests preserve selection,
relevant semantic scope, project version, and idempotency key. Missing configuration stores request
in tab storage and links to Settings; provider failure preserves draft, scope, and retry action.

Pending candidates render dashed, explicitly non-approved preview nodes and semantic edges. Reject
dismisses preview through terminal persisted rejection without semantic mutation; rejected previews
stay absent after reload. Accept applies whole candidate under loaded project
version. Conflict reloads authoritative graph while preserving proposal for review and retry.
All project-version semantic writes share one client queue and read the latest confirmed version only
when their turn starts. Canvas capture, quick capture, inspector edits, proposal terminal actions, and
challenge resolution remain responsive while delayed writes commit in user-action order.
Challenge panel shows rationale, dependencies, confidence, downstream effect, resolve/defer/
override actions, required override note, live announcement, and history link. Mobile stacks same
complete work-panel controls below focused canvas with 44-pixel targets and visible focus.

Missing AI configuration preserves scoped selected node, analysis type, project version, and
idempotency key in tab storage. Settings accepts only validated same-origin `returnTo`, shows explicit
return link, and never auto-runs preserved request. Returning restores selection and offers Retry or
Cancel; storage clears only after successful analysis or explicit cancellation. Challenge resolution
hydrates on selection and reload, disables terminal actions, and shows immutable note, resolver,
timestamp, record identity, and status in a dedicated anchored resolution-history list separate from
node revision history. The immutable archive remains visible after converting the node away from
challenge and after reload. Hermes challenge reasoning uses structured dependencies, numeric
confidence, and downstream effect rather than parsing display tags.

Temporary semantic-save failures queue a bounded maximum of 25 edits per authenticated owner and
project in browser storage. Records contain schema version, idempotency key, expected version,
operation, and a payload capped at 64 KiB; provider keys, prompts, raw provider payloads, tokens, and
credentials are rejected. Storage denial, malformed records, and quota errors degrade safely to the
current in-tab draft. Pending edits replay in creation order on reload or reconnect, clear only after
success, stop at first version conflict or local-clear failure, and trigger a page-close warning while
any remain. Replay sends exact stored expected version and idempotency key; at-most-once server replay
prevents lost success response from duplicating mutation.

Only offline/network failures, HTTP 408/425/429, and temporary 5xx/store failures enter recovery.
Authentication, authorization, missing-owner/project, version conflict, payload-size, and validation failures
remain in the current tab with actionable status and are never silently queued. Terminal legacy records are
retained and surfaced in an accessible review with bounded operation/category/submitted semantic values rather
than retried forever. Confirmed Discard removes the exact durable record; Keep in tab removes it durably and
moves it to dedicated held terminal memory that reconnect never enqueues or replays. An accessible bounded review
shows safe submitted values. Update-node recovery can be explicitly confirmed and applied with a fresh idempotency
key against latest node/project versions; failed apply remains held. Every held operation can be explicitly
discarded. Successful apply or discard clears only that exact held item. Both unblock later ordered records. Failed durable removal leaves
the review blocking with truthful recovery status. If browser storage is denied or full,
the operation remains explicitly in memory with “Not stored—keep this tab open”; page-close warning follows
known stored or in-memory work, never storage uncertainty alone. An online event retries only retryable edits
whose initial durable storage failed, never held terminal work.

Conflict review hydrates authoritative project plus operation-specific records: node create/update/trash/restore,
edge and endpoint records, proposal state/candidate, or challenge node/latest resolution. Compare is read-only.
Keep mine requires explicit confirmation, a fresh idempotency key, and latest record/project versions; failed
retry leaves conflict and recovery record intact. Accept latest clears recovery without moving canvas viewport
or selection. Successful node resolution issues a one-shot editor focus token; the remounted inspector focuses
only after its title-input ref exists, then acknowledges and clears that exact token. Provider failures
likewise preserve selection, viewport, scoped request, and draft. Large graphs simplify node/edge
detail, collapse tagged distant clusters to one selection-protected representative, and offer explicit
Expand/Collapse action. Deterministic 250-node/400-edge Chromium fixture proves narrow live viewport
subscription keeps freehand and authenticated media aligned without semantic node re-render.

Trash is durable semantic history, not an undo-only illusion. Workspace lists owner/project-scoped trashed nodes after load or reload and restores one explicitly with current node and project versions. Failed restore leaves item listed with recovery text; successful restore returns it to graph and removes it from Trash. MVP exposes no permanent node deletion.

## Starter Brand Blueprint

`/projects/[projectId]/blueprint` is protected Blueprint reading and publication workspace. Client
loads current project metadata, authoritative server readiness, and immutable server snapshots; it
never rebuilds sections from client graph state. User explicitly creates snapshot against loaded
semantic project version. Version conflict creates nothing, reloads current project/readiness/history,
and asks user to review before retry. Existing history remains unchanged on every failure.

Every snapshot renders all MVP sections from canonical server payload, including explicit empty or
in-progress states. Entries distinguish evidence, assumptions, approved direction, and unresolved
Hermes challenges; rationale expands through keyboard-operable disclosure without hover. Source links
show immutable source node IDs and return to exact editor node through `?node=` focus. IDs remain
literal traceability text in print while interactive wording and URL decoration are suppressed. Snapshot history exposes sequence, source graph
version, and UTC publication date. Selecting history never mutates it. Viewing snapshot behind current
graph displays stale notice and requires new explicit snapshot to publish newer state. Blueprint title
always comes from immutable snapshot `project_title`; later project renames cannot rewrite history.

Paper, Graphite, and Project use same responsive semantic structure and bounded accessible project
accent. Export PDF invokes browser print from same HTML used in-app. Print removes application,
editor, history, and action chrome; uses opaque high-contrast surfaces; retains restrained project
accent; repeats title/version/date metadata; and applies section/page-break rules. PDF never includes
canvas layout, annotations, media, or live reconstructed graph content. Live stale notices, request
progress, and errors are screen-only; canonical snapshot readiness warnings remain in print.
Print uses opaque white surfaces and a separately derived project accent measured at least 3:1 against
white. Accent-colored text becomes neutral print ink so all print text retains at least 4.5:1 contrast.
