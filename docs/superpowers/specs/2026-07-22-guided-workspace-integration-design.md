# Guided Workspace Integration Design

**Date:** 2026-07-22
**Status:** Approved

## Summary

Creative Curator will become one guided workspace backed by the existing Hermes workflow. The root experience will replace placeholder chat, DNA, canvas, scheduler, and settings behavior with one shared creative session that advances through brief intake, generated brand DNA, three creative directions, rejection of exactly two directions, refinement, approval, and final artifact generation.

Hermes remains the server-side orchestrator and source of workflow truth. The frontend owns presentation, transient form drafts, busy states, and actionable errors; it must not duplicate transition rules. Remote Supabase changes, authentication, dashboard/session recovery, and real LLM chat are deferred.

## Product Experience

### Guided workspace

The root route uses three session-aware views:

1. **Brief** presents a guided form for required brand name and description plus optional goal and reference. Submission calls `POST /creative/start`.
2. **DNA** unlocks after session creation and renders the returned beliefs and tone sliders. DNA is read-only in this phase.
3. **Outputs** unlocks after session creation and owns direction comparison, rejection feedback, refined direction review, approval, and final artifact display.

Navigation changes which part of the same session is visible. Moving between unlocked views never creates a new session or loses state. An explicit Start over action clears browser state without deleting the server record.

The interface displays progression as Brief → DNA → Directions → Refine → Artifact. Scheduler and fake settings controls are removed or hidden. The existing `/studio` route redirects to `/` after feature parity is proven.

### Core workflow

The intended state sequence is:

```text
no session → active → refined_ready → approved → executed
```

- `active`: DNA and three directions are available; user must reject exactly two.
- `refined_ready`: Hermes has converted feedback to constraints and generated one refined direction.
- `approved`: refined direction is locked; artifact generation may start or be retried.
- `executed`: caption, safe visual artifact, and rationale are available.

Approval without refinement is not allowed. Execute is idempotent: repeating it returns the existing artifact instead of generating a second one.

## Frontend Architecture

A workspace-level session provider owns the current `CreativeSession`, active view, rejection drafts, busy operation, and error state. Focused Brief, DNA, and Outputs components consume that provider. One typed API module owns request/response types and the four backend operations; view components do not call `fetch` directly.

The guided brief uses the same length and required-field rules as FastAPI. Rejection UI allows exactly two distinct directions and preserves selections/notes when a request fails. The combined Approve and generate action may call approve then execute, but if execution fails after approval the UI changes to a Generate artifact retry that calls only execute.

The frontend treats every successful backend response as authoritative session state. Errors behave as follows:

- `422`: display useful validation detail and preserve form data.
- `404`: explain that the session is unavailable and offer Start over.
- `409`: explain invalid workflow state without discarding current UI data.
- Network failure: retain all drafts and expose retry.

Browser refresh recovery, session URLs, session history, dashboard, and login are deferred. Losing current UI state on refresh is accepted for this MVP.

## Backend Architecture and Contract

FastAPI exposes explicit Pydantic request and response models for:

- `POST /creative/start`
- `POST /creative/reject`
- `POST /creative/approve`
- `POST /creative/execute`

Hermes validates transitions and direction ownership:

- Reject accepts exactly two distinct rejections in one request.
- Both direction IDs must exist in the active session.
- Reject is valid only while the session is `active`.
- Approve is valid only when status is `refined_ready`.
- Execute is valid when status is `approved` or `executed`.

FastAPI maps missing sessions to `404`, invalid transitions/directions to `409`, and schema validation failures to `422`. Hermes continues coordinating DNA, direction, critic, and content agents and persists each successful transition through `SessionStore`.

Python 3.11 is the minimum supported backend runtime. Project setup and automation must not rely on the existing Python 3.9 environment.

## SVG Safety

Backend artifact generation XML-escapes every dynamic value before placing it into SVG text. The frontend removes `dangerouslySetInnerHTML` and displays the SVG through an image data URL so returned markup cannot create live DOM nodes. Tests use hostile brand/goal values to prove escaping and verify the dangerous rendering path is absent.

## Local Supabase Development

All development and integration work uses a local Supabase instance. The installed Supabase CLI and Docker run the stack through `supabase start`; backend local configuration lives in an ignored `backend/.env.local` and is loaded explicitly by the development command.

The existing remote `backend/.env` is never loaded by tests or documented local commands. No workflow may run `supabase link`, `supabase db push`, linked migrations, or other remote mutations without explicit user approval.

The create-table migration remains usable locally. The destructive rollback helper moves outside `supabase/migrations/` so `supabase db reset` cannot create and then immediately drop the table. Current permissive RLS behavior remains unchanged and is documented as deferred hardening.

Fast unit and API contract tests use `InMemorySessionStore`. A separate opt-in persistence integration test targets only local Supabase and proves create, load, and update behavior.

## Testing and Acceptance

Backend coverage includes:

- Full valid Hermes lifecycle.
- Wrong rejection count, duplicate IDs, and unknown IDs.
- Approval before refinement and other invalid transitions.
- Idempotent execution.
- FastAPI request/response contracts and `404`/`409`/`422` behavior.
- XML escaping of hostile artifact text.
- Optional local-Supabase persistence round trip.

Frontend coverage includes:

- Lint and production build.
- Playwright happy path from guided brief through final artifact.
- Navigation between Brief, DNA, and Outputs without session loss.
- Validation and backend-down error states retaining user input.
- Execute retry after successful approval.
- Absence of placeholder replies, static DNA/output data, and `dangerouslySetInnerHTML`.

Acceptance requires the root route to complete the real backend workflow, `/studio` to redirect to `/`, all mandatory checks to pass under Python 3.11, and no remote Supabase changes.

## Documentation and Agent Guidance

Implementation updates these authoritative documents in the same change as behavior:

- `README.md`: Python 3.11 setup, local Supabase commands, and root workflow.
- `docs/API.md`: exact schemas, states, and error responses.
- `docs/CLIENT_FLOW.md`: guided workspace navigation and UX states.
- `docs/DEVLOG.md`: architecture decision and deferred scope.
- `docs/DEMO_TUTORIAL.md`: verified end-to-end demonstration.

A new root `AGENTS.md` points future agents to these documents, defines which document owns each contract, requires docs updates when code changes public behavior, and prohibits remote Supabase operations without explicit approval. `client/AGENTS.md` keeps its Next.js-specific rules and references the root guidance plus `docs/CLIENT_FLOW.md` and `docs/API.md`.

## Deferred Work

- Remote Supabase migrations, RLS hardening, auth, and tenant ownership.
- Dashboard, saved-session browser, URL/localStorage recovery, and login.
- True freeform multi-turn chat and conversation parsing/history.
- Scheduler and nonfunctional settings/model controls.
- Replacing deterministic agents with an LLM provider.
