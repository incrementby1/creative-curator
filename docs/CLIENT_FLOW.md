# Client flow — Brand projects and Guided Workspace

`/` is authenticated and redirects to `/projects`, the primary project home. `/projects/new` is the adaptive diagnostic; `/settings` remains the protected AI provider and routing workspace. Project routes preserve owner isolation. Legacy Guided Workspace code remains available during rollout and is not used to infer Brand Constellation evidence or relationships.

## Projects and adaptive diagnostic

Projects home loads one bounded page of at most 50 authenticated-owner summaries in one HTTP request; it never issues one status request per project. Each compact row shows project title, update time, authoritative Blueprint readiness, unresolved challenge count excluding resolved/deferred/overridden challenges, and one Open action. If batch loading fails, no partial or fabricated rows render: page reports unavailable Projects and offers Retry. Empty state explains first step and links directly to project creation. Desktop and mobile account navigation exposes Projects, current project when one was most recently created, Settings, legacy workspace, and spatially separated sign-out.

Adaptive diagnostic waits for authenticated identity before mounting fields. Its user-keyed form reads the scoped local draft synchronously in the initial client-state initializer, so no late effect can overwrite typing; loading state exposes no prematurely editable form. It collects working project name, intent, known facts, assumptions, constraints, desired outcomes, and open questions. Only project name is required. Nonempty trimmed answers may seed at most 12 nodes total, and each answer/line is capped at 500 characters. Accessible validation runs before project creation; over-limit diagnostics create neither project nor nodes. User may skip diagnostic, save and return, or submit partial answers; empty answers remain empty and are never inferred. Draft persists locally under authenticated user identity. Submission first creates owner-scoped project, then converts each supplied line into typed semantic node with `user` creation source and explicit `Adaptive diagnostic — user supplied` provenance. Facts and constraints become evidence; stated assumptions and open questions become assumptions; intent and desired outcomes become ideas.

If project creation fails, local draft remains and retry is available. If later node seeding fails, project is not rolled back: client removes already-sent entries from recovery state, retains only unsent entries under user/new and user/project recovery keys, names created project in alert, and links directly to it. Same test/local account recovers project list after logout/login; different owner sees neither list row nor graph.

## Authentication

Unauthenticated visits to `/`, `/projects`, `/projects/new`, and `/settings` redirect to `/login` with an encoded same-origin `next` destination. Login supports email/password sign-in and sign-up through Supabase SSR. Only relative paths beginning with one `/` are accepted as intended destinations; absolute and protocol-relative values return to `/`. Sign-out clears the session and returns to login. Auth state survives refresh through cookies, while workspace drafts retain their existing React-only lifetime.

Local Auth sign-up auto-confirms email and requires at least eight password characters. Same local account recovers its encrypted provider metadata and routing after logout/login; another account remains isolated. No browser flow lists or restores persisted creative sessions.

The form uses visible labels, email/current-or-new-password autocomplete, blur validation, generic credential errors, pending controls, an accessible password reveal, and alert/live semantics. Invalid sign-in preserves email, clears password, and returns focus to the password field. Missing auth configuration produces a stable accessible recovery message instead of leaving the form silently disabled. Failed sign-out keeps the current page and authenticated UI in place, reports a recoverable alert beside the control, and redirects only after confirmed success.

Playwright uses a guarded deterministic auth client only when `NEXT_PUBLIC_AUTH_MODE=test` and the build is not production. It stores `test-user:<stable-id>` in a same-site path cookie, accepts only the fixed test password, restores the same identity for the same normalized email, and creates no Supabase client or network request. Production ignores test mode.

## AI provider settings

Settings loads the authenticated owner's Hermes-compatible provider catalog and routing together. A labeled case-insensitive filter matches provider display name or slug while preserving manifest order, announces result count, and offers clear recovery for no matches. Providers appear as flat rows with explicit `Not connected`, `Connected`, or `Needs attention` text plus their primary/fallback model use or `Not used in routing`. Disconnected rows expose one Connect action; saved and attention-needed rows expose one Manage action. Expanded management contains replacement-key controls and a spatially separated Disconnect action. Inline editor uses a labeled password field, reveal control, model entry, and supported endpoint override. API keys remain only in React state until submitted: connection testing is transient, Save becomes available only after successful test, backend revalidates during save, failed save preserves draft for correction, and raw key is cleared and never redisplayed after success. Model discovery runs after successful test and supplies suggestions without preventing valid manual entry.

Saved rows show only final four-character suffix and public connection metadata. Disconnect uses inline confirmation, moves focus to confirmation, and returns focus to trigger when cancelled. While deletion is pending, confirmation, cancellation, close, reveal, and draft controls remain disabled so user cannot hide confirmation or erase in-flight context; there is no misleading client-side cancellation. Failed disconnect re-enables controls and retains replacement draft for recovery, while successful disconnect clears every transient secret/model field before returning to disconnected state. Providers referenced by routing show direct recovery instead of being removed. Settings survive logout and login for same account, while another account cannot see connection metadata.

Routing selects one connected primary provider and manual model, plus up to five ordered fallbacks. Every fallback can be added, removed, or moved with labeled keyboard-operable buttons. Save remains unavailable until primary and every fallback reference a currently connected provider and contain a model. Exact normalized provider/model pairs must be unique among fallbacks and cannot repeat primary; same provider with a different model remains valid. If a routed provider later needs attention or disconnects, its current unavailable selection remains visible but cannot be newly selected; primary selector stays available so owner can choose `No primary provider`, save empty route, then disconnect last credential. A new meaningless empty save stays unavailable. Saving uses loaded optimistic version. A stale write reloads latest routing and announces recovery instead of overwriting another change.

Settings requests use a fresh current access token and `Authorization: Bearer`. One `401` retries once after normal auth-client session read/refresh behavior; final `401` returns to login with safe same-origin Settings destination. FastAPI errors become concise recovery text and never render submitted keys.

During generation, routing tries primary first, then each configured fallback in displayed order. Authentication/decryption failures mark only exact credential version as `Needs attention`; timeout, rate-limit, unavailable, invalid-response, and configuration failures remain typed safe categories. Missing routing opens Settings recovery; total exhaustion preserves prior workspace state for retry.

## Workspace shell

One protected route-group layout owns account navigation, the Clear Workbench shell, and a shared React workspace provider. **Workspace** and **Settings** are top-level destinations; sign-out is spatially separated. The provider stays mounted during client-side navigation between them, so an unsaved Workspace draft survives a visit to Settings and back. Refresh still clears React-only workspace state.

Inside Workspace, **Brief**, **DNA**, and **Outputs** share session, Brief draft, rejection drafts, request epoch, busy state, and API error status. Before a session begins, only Brief is unlocked; creating one unlocks DNA and Outputs. Navigation does not refetch or replace shared state. Desktop uses a persistent flat side navigation. Mobile uses one overlay drawer with contained focus, opener restoration, and the top-level destinations available inside the same trap. While the drawer is modal, the main-content skip link is inert, hidden from accessibility navigation, and removed from tab order; closing restores it. Mobile sign-out closes the drawer and restores the opener before authentication completes, so a failed resolved or thrown sign-out exposes its recovery alert outside the inert region and leaves the workspace usable. A skip link reaches main content whenever no modal is open.

## Brief

Brief collects required brand name and one-sentence description, plus optional goal and reference. Submit sends `POST /api/creative/start`. Once created, Brief becomes read-only summary; **Start over** clears current session, output, Brief fields, rejection drafts, local error, and pending-operation state, then returns to empty editable Brief. A request epoch prevents delayed responses from restoring discarded browser state.

## DNA

DNA is read-only. It presents three Hermes-generated beliefs and two visual tone meters. It is hypothesis for current creative round, not user-editable brand profile.

## Outputs

Outputs first shows three direction cards: tone, visual language, creative intent, why it works, palette, and channels. User selects exactly two cards to reject, chooses structured reason for each, and may add note. Client prevents submitting any count other than two; request goes to `POST /api/creative/reject`.

Backend then returns constraints and refined survivor. Outputs shows refined card and its carried-forward constraints. **Approve and generate artifact** sends approve, then execute. If execute fails after approval, UI stays in approved state and offers **Generate artifact** retry; retry calls execute only and does not approve again. Execute is backend-idempotent.

Completed output shows caption, three-point rationale, and SVG layout mock. The deterministic renderer wraps normal copy and unbroken generated tokens inside the layout while preserving the complete text. SVG is encoded as `data:image/svg+xml` and rendered with Next `Image`; client does not inject live HTML.

## Errors and local state

Client shows service and validation errors in shared live status area. Network failures use an actionable service-unavailable message. A typed `ai_configuration_required` error includes direct **Open Settings** recovery; a `404` includes direct **Start over** recovery. Failed start preserves typed Brief input. Failed rejection preserves selected rejection drafts, reasons, and notes. Lost approval responses can retry the combined action safely because approval is idempotent. Workspace provider owns session and all drafts, so navigation between views and protected destinations preserves both. Refresh loses all React-only session and drafts; this is accepted current behavior.

On mobile, primary navigation is a modal dialog while open: background is inert, focus enters and stays inside drawer, and Escape, backdrop, or a navigation choice closes it and restores focus to menu control. Resizing to desktop clears mobile overlay state.

## Deliberate omissions

No dashboard, recovered creative sessions, remote persistence setup, or freeform assistant conversation. Authentication persists account access and owner-scoped AI settings only; local Supabase creative persistence remains backend-only and does not add browser recovery.

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
project persistence. Precision arrangement is desktop-first; later mobile work supplies the
focused graph navigator.

Quick capture accepts evidence, assumptions, ideas, concerns, and decisions without calling a
provider. Local typed previews persist against latest loaded project version; failure removes
optimistic graph content while retaining exact form draft for retry. Selecting one node opens
inspector and guided exploration without disabling canvas. Hermes requests preserve selection,
relevant semantic scope, project version, and idempotency key. Missing configuration stores request
in tab storage and links to Settings; provider failure preserves draft, scope, and retry action.

Pending candidates render dashed, explicitly non-approved preview nodes and semantic edges. Reject
dismisses preview without semantic mutation. Accept applies whole candidate under loaded project
version. Conflict reloads authoritative graph while preserving proposal for review and retry.
Challenge panel shows rationale, dependencies, confidence, downstream effect, resolve/defer/
override actions, required override note, live announcement, and history link. Mobile stacks same
complete work-panel controls below focused canvas with 44-pixel targets and visible focus.
