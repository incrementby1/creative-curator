# Client flow — Guided Workspace

`/` is the authenticated Guided Workspace. `/studio` is retired and redirects to `/`. `/settings` is reserved as a protected destination; its provider UI is not implemented yet. There is no dashboard, saved-session recovery, or freeform chat in current product.

## Authentication

Unauthenticated visits to `/` and `/settings` redirect to `/login` with an encoded same-origin `next` destination. Login supports email/password sign-in and sign-up through Supabase SSR. Only relative paths beginning with one `/` are accepted as intended destinations; absolute and protocol-relative values return to `/`. Sign-out clears the session and returns to login. Auth state survives refresh through cookies, while workspace drafts retain their existing React-only lifetime.

The form uses visible labels, email/current-or-new-password autocomplete, blur validation, generic credential errors, pending controls, an accessible password reveal, and alert/live semantics. Invalid sign-in preserves email, clears password, and returns focus to the password field. Missing auth configuration produces a stable accessible recovery message instead of leaving the form silently disabled. Failed sign-out keeps the current page and authenticated UI in place, reports a recoverable alert beside the control, and redirects only after confirmed success.

Playwright uses a guarded deterministic auth client only when `NEXT_PUBLIC_AUTH_MODE=test` and the build is not production. It stores `test-user:<stable-id>` in a same-site path cookie, accepts only the fixed test password, restores the same identity for the same normalized email, and creates no Supabase client or network request. Production ignores test mode.

## Workspace shell

One shared React provider powers three navigation views: **Brief**, **DNA**, and **Outputs**. It owns session, Brief draft, rejection drafts, request epoch, busy state, and API error status. Before a session begins, only Brief is unlocked; creating one unlocks DNA and Outputs. Navigation does not refetch or replace shared state.

## Brief

Brief collects required brand name and one-sentence description, plus optional goal and reference. Submit sends `POST /api/creative/start`. Once created, Brief becomes read-only summary; **Start over** clears current session, output, Brief fields, rejection drafts, local error, and pending-operation state, then returns to empty editable Brief. A request epoch prevents delayed responses from restoring discarded browser state.

## DNA

DNA is read-only. It presents three Hermes-generated beliefs and two visual tone meters. It is hypothesis for current creative round, not user-editable brand profile.

## Outputs

Outputs first shows three direction cards: tone, visual language, creative intent, why it works, palette, and channels. User selects exactly two cards to reject, chooses structured reason for each, and may add note. Client prevents submitting any count other than two; request goes to `POST /api/creative/reject`.

Backend then returns constraints and refined survivor. Outputs shows refined card and its carried-forward constraints. **Approve and generate artifact** sends approve, then execute. If execute fails after approval, UI stays in approved state and offers **Generate artifact** retry; retry calls execute only and does not approve again. Execute is backend-idempotent.

Completed output shows caption, three-point rationale, and SVG layout mock. SVG is encoded as `data:image/svg+xml` and rendered with Next `Image`; client does not inject live HTML.

## Errors and local state

Client shows service and validation errors in shared live status area. Network failures use an actionable service-unavailable message. A `404` error includes direct **Start over** recovery. Failed start preserves typed Brief input. Failed rejection preserves selected rejection drafts, reasons, and notes. Lost approval responses can retry the combined action safely because approval is idempotent. Workspace provider owns session and all drafts, so navigation between views preserves both. Refresh loses all React-only session and drafts; this is accepted current behavior.

On mobile, primary navigation is a modal dialog while open: background is inert, focus enters and stays inside drawer, and Escape, backdrop, or a navigation choice closes it and restores focus to menu control. Resizing to desktop clears mobile overlay state.

## Deliberate omissions

No dashboard, recovered creative sessions, remote persistence setup, settings UI, or freeform assistant conversation. Authentication persists account access only; local Supabase creative persistence remains backend-only and does not add browser recovery.
