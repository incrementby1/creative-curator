# Client flow — Guided Workspace

`/` is the authenticated Guided Workspace. `/studio` is retired and redirects to `/`. `/settings` is the protected AI provider and routing workspace. There is no dashboard, saved-session recovery, or freeform chat in current product.

## Authentication

Unauthenticated visits to `/` and `/settings` redirect to `/login` with an encoded same-origin `next` destination. Login supports email/password sign-in and sign-up through Supabase SSR. Only relative paths beginning with one `/` are accepted as intended destinations; absolute and protocol-relative values return to `/`. Sign-out clears the session and returns to login. Auth state survives refresh through cookies, while workspace drafts retain their existing React-only lifetime.

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
or return semantic records. Media display uses an authenticated fetch and a temporary object URL,
never a public storage URL. Paper and Graphite use fixed accessible interface tokens. Project theme
retains approved palette values as source data while deriving contrast-safe interface tokens; it
falls back to Paper until an approved visual-palette decision exists.
