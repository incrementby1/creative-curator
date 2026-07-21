# Devlog

## 2026-07-22 — Guided Workspace integration

Hermes is now source of truth for one strict creative session. FastAPI exposes typed start, reject, approve, and execute contracts; lifecycle is `active` → `refined_ready` → `approved` → `executed`. Two distinct direction rejections are required before refinement, approval cannot skip refinement, and execute is idempotent.

Client moved demo to root Guided Workspace with shared Brief, DNA, and Outputs session state. `/studio` now redirects to `/`. Workspace provider owns rejection drafts and preserves them after failed requests and workspace navigation; network failures show a stable service-unavailable message. Browser refresh intentionally loses React-only state. Final SVG is encoded into image data URL rather than injected as live HTML.

Coverage now includes backend lifecycle/API checks and Playwright Guided Workspace flow, validation preservation, retry semantics, redirect, responsive navigation, and artifact rendering. Runtime contract is Python 3.11+. Project AGENTS governance now requires authoritative docs stay synchronized with implementation.

Persistence remains optional local Supabase only. Available migration creates `creative_sessions` when applied to local stack; manual rollback helper is separate so reset does not automatically remove schema. In-memory fallback covers Supabase store construction/config initialization only; create/get/save failures propagate. Live local persistence integration skips only when local URL/key env is absent and fails if configured Docker/local stack is offline. Current permissive RLS is explicitly demo-only and not production-safe.

Deferred: remote RLS hardening, authentication and ownership, dashboard and session recovery, freeform chat, and LLM-backed generation.

## 2026-07-15 — First MVP branch

Initial branch established FastAPI API, deterministic Hermes agents, Next.js client, local setup instructions, and backend tests. Later integration superseded its loose demo flow with current strict Guided Workspace contract.
