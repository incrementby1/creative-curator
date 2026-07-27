# Changelog

## 2026-07-27 — Constellation-only production workspace

- Removed guided workspace and saved-session archive from active product, route, client-flow, and HTTP contracts. Removed URLs and endpoints now use normal Not Found behavior.
- Made Brand Constellation sole production journey.
- Documented centered eight-button icon-only desktop dock, hover/focus tooltips, selected-node Inspector connection and sizing operations, and one chronological Undo and Redo history across graph and annotation commands.
- Retained historical `creative_sessions` rows and migration definitions. No runtime route reads or mutates them, and no destructive migration or data conversion is part of removal.
- Replaced documentation tests through RED → GREEN. RED command: `.venv/bin/python -m unittest tests.test_spatial_documentation -v` — 10 run, 4 failures, 0 errors, 0 skips. GREEN command: `.venv/bin/python -m unittest tests.test_spatial_documentation tests.test_ci_workflow -v` — 13 run, 13 passed, 0 failures, 0 errors, 0 skips.
- No remote Supabase or provider operation ran.
