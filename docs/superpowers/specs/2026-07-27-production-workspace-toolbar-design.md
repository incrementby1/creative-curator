# Production Workspace and Compact Toolbar Design

**Date:** 2026-07-27  
**Status:** Approved for implementation planning

## 1. Objective

Make Brand Constellation the only production workspace, remove the obsolete guided-workspace and legacy-session product surfaces, and replace the overflowing canvas toolbar with a compact icon-only dock. The dock exposes one chronological Undo/Redo pair, while precise keyboard-equivalent graph controls move into the selected-node Inspector.

This change does not destructively migrate or delete historical database rows. It removes their runtime product access.

## 2. Approved scope

### 2.1 Remove legacy product behavior

- Delete the `/studio` guided-workspace page.
- Delete the `/projects/legacy/[sessionId]` read-only legacy-session page.
- Remove the `Legacy workspace` navigation destination.
- Remove the `Legacy sessions` archive from Projects.
- Remove obsolete guided-workspace and legacy-session client components, providers, styles, API clients, backend endpoints, and tests that exist only for those surfaces.
- Remove legacy workflow behavior from active product, client-flow, HTTP, setup, and persistence documentation.
- Remove obsolete legacy screenshots from the current production evidence index.
- Old legacy URLs use the normal application Not Found behavior. They do not redirect to a hidden compatibility surface.

Historical migration definitions and existing persisted legacy rows remain untouched. No destructive migration, remote Supabase operation, or implicit data conversion is part of this work. The application exposes no UI or HTTP path that reads or mutates those rows.

### 2.2 Compact canvas dock

The desktop canvas uses one centered, single-row dock containing eight controls in this order:

1. Select
2. Connect
3. Draw
4. Erase
5. Add thought
6. Add media
7. Undo
8. Redo

Every control has invariant 44 by 44 CSS-pixel geometry. Mode controls, creation controls, and history controls are separated by restrained one-pixel dividers. Buttons display icons only at rest; no visible text participates in dock sizing.

Each button retains an explicit accessible name. Hover and keyboard focus reveal a concise tooltip matching that name. Tooltips do not receive focus, alter layout, or become the only accessible label. The active mode exposes `aria-pressed` and an opaque selected state in Paper, Graphite, and Project themes. Disabled history controls remain legible and noninteractive.

The dock must not scroll horizontally, clip, shrink its controls, or overflow the supported desktop canvas. Mobile continues using its purpose-built focus workflow and does not render a compressed version of the desktop dock.

Freehand drawing behavior is unchanged. Pointer initiation remains blocked when the event target is within the dock, React Flow controls, minimap, or a graph node.

## 3. Unified interaction history

Only one Undo control and one Redo control are visible. They operate on the most recent eligible user action across semantic graph and annotation domains.

The browser history stores an ordered, strictly validated command envelope containing:

- schema version;
- owner and project identifiers;
- domain: `graph` or `annotation`;
- operation and minimum inverse payload;
- required item and project versions where the owning domain uses compare-and-swap;
- idempotency identity where required; and
- creation time.

History is capped at 50 commands per owner/project. A successful new command clears the redo stack. Invalid, malformed, or cross-owner/project records are discarded. Storage denial cannot roll back a successful server mutation; it reports reduced history durability while preserving the authoritative save result.

Undo and Redo delegate to the command's owning persistence domain:

- graph commands continue through the serialized semantic mutation queue and current authoritative versions;
- annotation commands continue through annotation persistence and never enter semantic revisions, Hermes context, Blueprint readiness, or Blueprint source data.

A command moves between history stacks only after its owning mutation succeeds. Retryable failures keep the command available and expose an actionable domain-specific status. Terminal conflicts preserve truthful current state and require the existing explicit recovery path; the client never pretends that a failed inverse action succeeded.

## 4. Inspector graph controls

The toolbar button labeled `Keyboard graph controls` and its floating console are removed.

Equivalent non-pointer operations move into the selected-node Inspector:

- **Connect nodes** selects a labeled target and relationship type, then creates the relationship through the same semantic mutation queue as pointer connection.
- **Size & position** edits bounded width and height values for the selected node and saves them through layout persistence. Position remains available through existing keyboard movement behavior rather than arbitrary unbounded numeric coordinates.

Controls use ordinary headings, labels, descriptions, validation, and status messages. They are available by keyboard and assistive technology without requiring knowledge of a separate “keyboard console.” Pointer handles remain available on the canvas.

## 5. Responsive and visual behavior

The selected approach is **A — Single compact dock**. The dock remains centered above the bottom canvas edge with fixed control geometry and restrained elevation. Its resting width is determined only by eight controls, two dividers, gaps, border, and padding.

All three themes preserve identical geometry, DOM order, accessible names, tooltip placement, and selected/disabled behavior. Theme tokens change only opaque surfaces, borders, text/icon color, focus indication, and selection emphasis. Tooltips maintain WCAG 2.2 AA contrast.

At widths where the product switches to mobile focus mode, the desktop dock is absent. There is no intermediate horizontally scrollable toolbar state.

## 6. Error handling and recovery

- Legacy URLs return the standard Not Found page.
- Legacy HTTP endpoints are unregistered and return Not Found rather than fabricated empty data.
- Unified-history persistence failure reports reduced history durability without changing graph or annotation save status.
- Undo/Redo failure reports the owning domain and leaves the command retryable when safe.
- Inspector connection or layout failure retains the user's selection and entered values and provides a retry path.
- Tooltips never obscure activation, trap focus, or remain visually stuck after pointer exit, blur, or Escape.

## 7. Verification

Implementation follows RED → GREEN TDD. Regression coverage must prove:

- `/studio` and `/projects/legacy/*` are absent;
- legacy navigation, Projects archive, client calls, and backend endpoints are absent;
- historical database definitions are not destructively dropped;
- the desktop dock renders exactly eight icon-only controls and one Undo/Redo pair;
- every tool has an accessible name and hover/focus tooltip;
- tooltips dismiss on pointer exit, blur, and Escape;
- cross-domain actions undo and redo in true chronological order;
- failed inverse operations do not corrupt history stacks;
- Inspector connection and sizing are keyboard operable and use existing persistence boundaries;
- the dock does not overflow at supported desktop widths in Paper, Graphite, or Project themes;
- mobile focus mode, accessibility, focus behavior, drafts, and session state remain intact; and
- no annotation or media record enters Hermes context or Blueprint readiness.

Before handoff, run the complete backend suite and mandatory client lint, TypeScript, unit, build, and Playwright gates. Refresh desktop and mobile evidence for every theme and report exact commands, counts, skips, and failures.

## 8. Documentation ownership

Implementation and authoritative documentation change together:

- `PRODUCT.md`: Brand Constellation-only production scope.
- `DESIGN.md`: compact dock, Inspector equivalents, and unified history behavior.
- `README.md`: active routes and verification.
- `docs/CLIENT_FLOW.md`: product navigation and interaction contract.
- `docs/API.md`: removal of legacy runtime endpoints.
- `docs/SUPABASE.md`: historical rows retained but unreachable; no destructive migration.
- `docs/DEVLOG.md`: implementation history and exact verification.
- Evidence index: production-only desktop/mobile/theme captures.

## 9. Rejected approaches

- **Segmented dock:** stronger grouping added unnecessary nested chrome without reducing width.
- **Two-row palette:** reduced width but occupied more canvas and weakened the left-to-right action sequence.
- **Scrollable or shrinking toolbar:** preserved visible labels at the cost of clipping, inconsistent scale, and poor discoverability.
- **Separate graph and annotation arrows:** exposed persistence architecture rather than the user's action history.
- **Renamed keyboard console:** retained a detached, unclear interaction model instead of locating precise operations in the selected-node Inspector.
- **Destructive legacy-data migration:** created needless production risk when removing runtime access satisfies the product requirement.
