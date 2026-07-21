# Client flow — Guided Workspace

`/` is the Guided Workspace. `/studio` is retired and redirects to `/`. There is no login, dashboard, saved-session recovery, or freeform chat in current product.

## Workspace shell

One shared React session powers three navigation views: **Brief**, **DNA**, and **Outputs**. Before a session begins, only Brief is unlocked; creating one unlocks DNA and Outputs. Navigation does not refetch or replace the shared React session.

## Brief

Brief collects required brand name and one-sentence description, plus optional goal and reference. Submit sends `POST /api/creative/start`. Once created, Brief becomes read-only summary; **Start over** clears local session, local error, pending-operation state, and returns to empty Brief.

## DNA

DNA is read-only. It presents three Hermes-generated beliefs and two visual tone meters. It is hypothesis for current creative round, not user-editable brand profile.

## Outputs

Outputs first shows three direction cards: tone, visual language, creative intent, why it works, palette, and channels. User selects exactly two cards to reject, chooses structured reason for each, and may add note. Client prevents submitting any count other than two; request goes to `POST /api/creative/reject`.

Backend then returns constraints and refined survivor. Outputs shows refined card and its carried-forward constraints. **Approve and generate artifact** sends approve, then execute. If execute fails after approval, UI stays in approved state and offers **Generate artifact** retry; retry calls execute only and does not approve again. Execute is backend-idempotent.

Completed output shows caption, three-point rationale, and SVG layout mock. SVG is encoded as `data:image/svg+xml` and rendered with Next `Image`; client does not inject live HTML.

## Errors and local state

Client shows service and validation errors in shared live status area. Failed start preserves typed Brief input. Failed rejection preserves selected rejection drafts, reasons, and notes. Navigation between views preserves session and rejection drafts because views remain mounted. Refresh loses all React-only session and drafts; this is accepted current behavior.

## Deliberate omissions

No authentication, dashboard, recovered sessions, remote persistence setup, or freeform assistant conversation. Local Supabase persistence is optional backend storage only; it does not add browser recovery.
