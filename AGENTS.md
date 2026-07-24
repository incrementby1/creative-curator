# Creative Curator project contract

Keep implementation and its authoritative documentation in sync in the same change.

| Document | Ownership |
| --- | --- |
| `docs/CLIENT_FLOW.md` | Product and client behavior |
| `docs/API.md` | HTTP and session-state contract |
| `docs/SUPABASE.md` | Local persistence workflow |
| `README.md` | Setup and verification |
| `docs/DEVLOG.md` | Project history |

## Runtime

- The backend requires Python 3.11 or newer.
- Follow `client/AGENTS.md` for Next.js work.
- Read `PRODUCT.md`, `DESIGN.md`, and the approved plan in `docs/superpowers/plans/2026-07-22-authenticated-hermes-byok.md` before changing product behavior.

## Contribution workflow

- Work on a feature branch, preserve unrelated changes, and keep commits small and focused.
- Pull requests must target `main` from a feature branch and use `.github/pull_request_template.md`. Complete every applicable section; mark non-applicable checks explicitly and explain why instead of deleting required testing or safety sections.
- Agent-authored pull requests must report exact verification commands, counts, skips, and failures; identify owning documentation; disclose deferred work; and attach desktop/mobile evidence for UI changes. Agents must not merge their own pull request or bypass required review and CI.
- Read the authoritative documents and approved design before changing behavior. Update code and the owning documents together.
- Use test-driven development for features and bugs: prove the intended test fails (RED), then write production code and make it pass (GREEN). Do not write production code first.
- Never commit secrets, generated environment files, build output, or test artifacts.
- Never run remote Supabase operations without explicit user approval.
- Before handoff, run every applicable full gate and report exact commands, counts, skips, and failures. Verify evidence directly; never claim a pass from an agent report.

## Testing rules

- Run backend code and tests on Python 3.11 or newer.
- Backend unit and API tests use `InMemorySessionStore` by default.
- Supabase integration tests require an explicit local URL and key plus hostname proof for `localhost` or `127.0.0.1`. Missing variables skip; configured tests fail if the local service is offline. Never target remote or live production services.
- Auth/settings integration additionally requires an explicit local service-role key, creates disposable local users, cleans them through the local admin API, and must never call a provider.
- Run the backend suite from `backend` with `python -m unittest discover -s tests -v`.
- Run all mandatory client gates from `client`: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm run test:e2e`.
- `.github/workflows/ci.yml` must keep backend, client-quality, and client-E2E checks aligned with these mandatory gates. Update `backend/tests/test_ci_workflow.py` with intentional CI contract changes.
- Playwright uses its config to run a real FastAPI backend with `InMemorySessionStore`; install Chromium during clean setup.
- Every behavior change adds regression coverage, with the intended RED verified before implementation.
- UI changes cover desktop and mobile layouts, accessibility and focus behavior, and preservation of user drafts and session state where the client contract requires it.
- After a fix, rerun the full affected suite. Do not run remote Supabase or live-production tests.

## Supabase safety

- Development uses Supabase locally only.
- Never run `supabase link`, `supabase db push`, linked migrations, or any remote mutation without explicit user approval.
- Persistence tests may use only in-memory stores or a URL proven to target `localhost` or `127.0.0.1`.
