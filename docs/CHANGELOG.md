# Changelog (session implementation)

This repo already had a basic **Next.js client** + **FastAPI backend** skeleton. In this session we aligned the implementation to the MVP loop:

**Intake → Brand DNA Hypothesis → 3 Directions → Reject 2 (structured) → Refined Direction → Approve → Final Content (caption + layout mock + rationale)**

And we added **optional Supabase persistence**.

## Backend changes

### Resolved backend conflict + implemented the full workflow

- **Replaced** `backend/app/core/hermes.py`
  - Fixed unresolved merge-conflict markers.
  - Implemented a session-based state machine:
    - `start_session()` returns session with `dna` + `directions`.
    - `handle_rejection()` accepts structured rejections (and supports legacy free-text reasons).
    - `approve()` approves a direction (defaults to first direction if no refined direction exists).
    - `execute()` generates the final content artifact.
  - Added persistence hook via `SessionStore` (in-memory default, Supabase optional).

### Introduced shared core types to avoid circular imports

- **Added** `backend/app/core/types.py`
  - Central dataclasses/types used across agents + Hermes:
    - `BrandDNA`, `ToneSlider`
    - `CreativeDirection`
    - `Rejection`, `RejectionReason`
    - `ContentArtifact`
    - `CreativeSession`

### Added/updated agents

- **Added** `backend/app/agents/dna_agent.py`
  - Produces the **Brand DNA hypothesis** (3 beliefs + 2 tone sliders).

- **Replaced** `backend/app/agents/direction_agent.py`
  - Deterministic direction generator enforcing divergence:
    - “Neighborhood Fun”
    - “Premium Artisan”
    - “Internet Chaos”
  - Adds `refine()` to create a single refined direction that explicitly references constraints.

- **Replaced** `backend/app/agents/critic_agent.py`
  - Converts structured rejection labels into concrete constraints.

- **Added** `backend/app/agents/content_agent.py`
  - Generates the **single final artifact**:
    - `caption`
    - `layout_mock_svg` (SVG layout mock)
    - `rationale` (3 bullets)

### Added persistence layer (in-memory by default, Supabase optional)

- **Added** `backend/app/persistence/session_store.py`
  - `InMemorySessionStore`
  - `SupabaseSessionStore` (uses `supabase` python package)
  - Auto-selection:
    - if `SUPABASE_URL` + (`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`) are set → Supabase
    - else → in-memory

### API contract updates

- **Updated** `backend/app/api/creative.py`
  - `POST /creative/start` now accepts:
    - `brand_name`, `description`, optional `goal`, optional `reference`
  - `POST /creative/reject` now accepts structured rejections:
    - `rejections: [{direction_id, reason, note?}]`
    - legacy `reasons: [string]` still supported
  - `POST /creative/approve` now accepts:
    - `{ session_id }` (no more `choice_id`)
  - **Added** `POST /creative/execute`:
    - returns `{ artifact, direction }`

### Dependencies + local env example

- **Updated** `backend/requirements.txt`
  - Added optional dependency: `supabase>=2.6,<3.0`

- **Added** `backend/.env.example`
  - Documents `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

### Tests

- **Updated** `backend/tests/test_hermes.py`
  - Updated to match the new Hermes API (`approve()` replaces `deploy()` etc.).
  - Added a small `sys.path` adjustment so tests can run from repo root.

## Supabase changes

### Migration

- **Applied** Supabase migration: `create_creative_sessions`
  - Creates `public.creative_sessions` table:
    - `id uuid` (primary key)
    - `brand_name`, `description`, `goal`, `status`, `state jsonb`
    - `created_at`, `updated_at` (+ trigger)
  - Enables RLS.
  - Adds a hackathon-speed policy: **allow all** (see security note in `SUPABASE.md`).

### Supabase URL (this environment)

The Supabase project URL used by the tooling in this environment was:

- `https://uivcpvqfiakmptlercnk.supabase.co`

This is not hardcoded in the app; the backend reads it from `SUPABASE_URL`.

## Added local migration files

- **Added** `supabase/migrations/20260718100737_create_creative_sessions.sql`
- **Added** `supabase/migrations/20260718100738_drop_creative_sessions.sql`
  - rollback helper if applied to the wrong project

## Client changes (single-page UI)

- **Updated** `client/app/page.tsx`
  - Intake fields now match backend:
    - brand name, one-sentence description, optional reference, optional goal
  - Renders Brand DNA (beliefs + visual sliders)
  - Renders 3 direction cards
  - Implements the core **structured rejection** UX:
    - select exactly 2 directions
    - pick a rejection reason label + optional note
  - Refined direction step
  - Approve + execute final artifact
  - Renders returned SVG via `dangerouslySetInnerHTML`

- **Updated** `client/app/page.module.css`
  - Reworked styling for a cleaner demo-ready single-page flow.

## README updates

- **Updated** `README.md`
  - Documented optional Supabase persistence and relevant env vars.
