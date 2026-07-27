# Changelog

## 2026-07-27 — Constellation-only production workspace

- Removed guided workspace and saved-session archive from active product, route, client-flow, and HTTP contracts. Removed URLs and endpoints now use normal Not Found behavior.
- Made Brand Constellation sole production journey.
- Documented centered eight-button icon-only desktop dock, hover/focus tooltips, selected-node Inspector connection and sizing operations, and one chronological Undo and Redo history across graph and annotation commands.
- Retained historical `creative_sessions` rows and migration definitions. No runtime route reads or mutates them, and no destructive migration or data conversion is part of removal.
- Replaced documentation tests through RED → GREEN. RED command: `.venv/bin/python -m unittest tests.test_spatial_documentation -v` — 10 run, 4 failures, 0 errors, 0 skips. Current GREEN command: `.venv/bin/python -m unittest tests.test_spatial_documentation tests.test_ci_workflow -v` — 15 run, 15 passed, 0 failures, 0 errors, 0 skips.
- Follow-up production scan added `docs/README.md` and `docs/DEMO_TUTORIAL.md` to regression coverage, then removed remaining route and saved-session recovery promises. Follow-up RED: 11 tests with 7 failing subtests. Final guard expansion RED: 13 tests with 8 failing variant subtests. Current GREEN: 15 of 15 passed.
- No remote Supabase or provider operation ran.
