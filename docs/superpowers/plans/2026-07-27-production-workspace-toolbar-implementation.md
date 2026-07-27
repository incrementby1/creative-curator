# Production Workspace and Compact Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every legacy workspace/session runtime surface and deliver a fixed-size icon-only canvas dock with one cross-domain Undo/Redo history and clear Inspector-based graph controls.

**Architecture:** Brand Constellation becomes the only runtime product. Historical database migrations and rows remain untouched, while legacy client routes and `/creative` backend orchestration are removed. A validated owner/project-scoped browser history coordinates semantic and annotation commands chronologically but delegates execution to their existing isolated persistence queues.

**Tech Stack:** Python 3.11, FastAPI, Next.js 16 App Router, React 19, TypeScript, React Flow, Lucide React, Vitest/Testing Library, Playwright, CSS modules, local/in-memory persistence.

---

## File structure and ownership

- `backend/app/main.py`: production API registration; no `/creative` router.
- `backend/app/composition.py`: settings, project, analysis, and Blueprint dependencies only.
- `backend/app/api/creative.py`: delete obsolete guided-session HTTP contract.
- `backend/app/agents/{dna_agent,direction_agent,critic_agent,content_agent}.py`: delete obsolete guided-session agents.
- `backend/app/core/{hermes,types}.py`: delete obsolete session lifecycle and types.
- `backend/app/persistence/session_store.py`: delete obsolete runtime session persistence; historical SQL remains.
- `backend/tests/test_production_runtime.py`: create a focused absence/composition regression contract.
- `client/app/(protected)/layout.tsx`: remove obsolete `WorkspaceProvider` wrapper.
- `client/app/(protected)/studio/page.tsx`: delete legacy page.
- `client/app/(protected)/projects/legacy/[sessionId]/page.tsx`: delete archive page.
- `client/app/components/creative-shell.tsx`: production navigation and mobile drawer only.
- `client/app/components/projects/project-list.tsx`: project list only; no legacy fetch/archive.
- `client/app/components/{workspace-context,workspace-content,brief-view,dna-view,outputs-view}.tsx`: delete old workflow.
- `client/app/components/projects/legacy-session.tsx`: delete old archive renderer.
- `client/app/lib/creative-api.ts`: delete obsolete client contract.
- `client/app/components/constellation/workspace-history.ts`: create validated cross-domain command history.
- `client/app/components/constellation/canvas-toolbar.tsx`: compact eight-button dock and accessible tooltips.
- `client/app/components/constellation/node-inspector.tsx`: selected-node connection and size controls.
- `client/app/components/constellation/constellation-editor.tsx`: coordinate unified history with semantic, annotation, and layout queues.
- `client/app/components/constellation/constellation.css`: fixed dock, tooltip, and Inspector layout styling.
- `client/e2e/production-surface.spec.ts`: create route/navigation absence coverage.
- `client/e2e/constellation.spec.ts`: cross-domain chronology, tooltip, Inspector, and overflow coverage.
- Authoritative docs and `docs/evidence/spatial-brand-workspace/`: production-only contract and refreshed evidence.

### Task 1: Remove the legacy backend runtime

**Files:**
- Create: `backend/tests/test_production_runtime.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/composition.py`
- Modify: `backend/app/llm/schemas.py`
- Modify: `backend/tests/test_composition.py`
- Modify: `backend/tests/test_llm_router.py`
- Delete: `backend/app/api/creative.py`
- Delete: `backend/app/agents/content_agent.py`
- Delete: `backend/app/agents/critic_agent.py`
- Delete: `backend/app/agents/direction_agent.py`
- Delete: `backend/app/agents/dna_agent.py`
- Delete: `backend/app/core/hermes.py`
- Delete: `backend/app/core/types.py`
- Delete: `backend/app/persistence/session_store.py`
- Delete: `backend/tests/test_creative_api.py`
- Delete: `backend/tests/test_content_agent.py`
- Delete: `backend/tests/test_hermes.py`
- Delete: `backend/tests/test_hermes_routing.py`

- [ ] **Step 1: Write the failing production-runtime test**

```python
from unittest import TestCase

from fastapi.testclient import TestClient

from app.composition import ApplicationComposition
from app.main import app


class ProductionRuntimeTests(TestCase):
    def test_legacy_creative_routes_are_not_registered(self) -> None:
        client = TestClient(app)
        for method, path in (
            ("post", "/creative/start"),
            ("post", "/creative/reject"),
            ("post", "/creative/approve"),
            ("post", "/creative/execute"),
            ("get", "/creative/sessions"),
            ("get", "/creative/sessions/old-session"),
        ):
            response = client.request(method.upper(), path, json={} if method == "post" else None)
            self.assertEqual(response.status_code, 404)
        self.assertFalse(any(path.startswith("/creative") for path in app.openapi()["paths"]))

    def test_composition_contains_no_session_runtime(self) -> None:
        self.assertNotIn("hermes", ApplicationComposition.__dataclass_fields__)
        self.assertNotIn("session_store", ApplicationComposition.__dataclass_fields__)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `backend`:

```bash
.venv/bin/python -m unittest tests.test_production_runtime -v
```

Expected: FAIL because `/creative` routes remain registered and `ApplicationComposition` still contains `hermes` and `session_store`.

- [ ] **Step 3: Reduce composition to production dependencies**

Remove guided-agent/session imports and fields. Keep the deterministic graph-analysis branch explicit:

```python
from app.llm.schemas import GraphAnalysisOutput, ProposedEdgeOutput, ProposedNodeOutput


@dataclass
class ApplicationComposition:
    settings_store: SettingsStore
    settings_service: SettingsService
    router: Any
    dispatcher: LlmDispatcher | None
    project_store: ProjectStore
    project_service: ProjectService
    analysis_service: GraphAnalysisService
    blueprint_compiler: BlueprintCompiler
```

In `build_composition`, create only `settings_store` and `project_store`, remove `session_store` and `Hermes(...)`, and return the reduced dataclass. In `DeterministicStructuredRouter.generate`, retain only the `GraphAnalysisOutput` branch and raise `TypeError("Unsupported deterministic output model")` for all other models.

- [ ] **Step 4: Unregister and delete the obsolete backend slice**

Remove these lines from `backend/app/main.py`:

```python
from app.api.creative import router as creative_router
app.include_router(creative_router, prefix="/creative")
```

Change the FastAPI description to:

```python
description="Spatial brand workspace API for Creative Curator.",
```

Delete the listed creative router, agents, Hermes/session types, session store, and tests. Remove guided-only schema classes from `backend/app/llm/schemas.py` and guided-only assertions from `backend/tests/test_llm_router.py`. Update `backend/tests/test_composition.py` to assert graph analysis, settings, projects, and Blueprint composition without accessing `composition.hermes`.

- [ ] **Step 5: Verify GREEN and no dangling imports**

```bash
.venv/bin/python -m unittest tests.test_production_runtime tests.test_composition tests.test_llm_router -v
rg -n "app\.api\.creative|app\.core\.hermes|session_store|composition\.hermes" app tests
```

Expected: focused tests PASS; `rg` returns no runtime imports or references.

- [ ] **Step 6: Commit the backend removal**

```bash
git add backend
git commit -m "refactor(backend): remove legacy session runtime"
```

### Task 2: Remove legacy client routes, archive, and workflow code

**Files:**
- Create: `client/e2e/production-surface.spec.ts`
- Modify: `client/app/(protected)/layout.tsx`
- Modify: `client/app/components/creative-shell.tsx`
- Modify: `client/app/components/projects/project-list.tsx`
- Modify: `client/app/styles/projects.module.css`
- Modify: `client/app/styles/shell.module.css`
- Modify: `client/next.config.ts`
- Modify: `client/proxy.ts`
- Modify: `client/e2e/auth-quality.spec.ts`
- Modify: `client/e2e/helpers/session.ts`
- Modify: `client/e2e/projects.spec.ts`
- Delete: `client/app/(protected)/studio/page.tsx`
- Delete: `client/app/(protected)/projects/legacy/[sessionId]/page.tsx`
- Delete: `client/app/components/workspace-context.tsx`
- Delete: `client/app/components/workspace-content.tsx`
- Delete: `client/app/components/brief-view.tsx`
- Delete: `client/app/components/dna-view.tsx`
- Delete: `client/app/components/outputs-view.tsx`
- Delete: `client/app/components/projects/legacy-session.tsx`
- Delete: `client/app/lib/creative-api.ts`
- Delete: `client/e2e/guided-workspace.spec.ts`

- [ ] **Step 1: Write the failing browser contract**

```typescript
import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

test("production navigation and Projects expose no legacy product", async ({ page }) => {
  await signInForTest(page, "/projects", "production-surface@example.com");
  await expect(page.getByRole("link", { name: "Legacy workspace" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Legacy sessions" })).toHaveCount(0);

  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await page.goto("/projects/legacy/old-session");
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npx playwright test e2e/production-surface.spec.ts
```

Expected: FAIL because the navigation link, archive region, and both routes still exist.

- [ ] **Step 3: Simplify the protected layout and shell**

Make `client/app/(protected)/layout.tsx` contain no workspace provider:

```tsx
import CreativeShell from "../components/creative-shell";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <CreativeShell>{children}</CreativeShell>;
}
```

In `creative-shell.tsx`, remove `useRouter`, all `useWorkspace` state, `WORKSPACE_NAV`, legacy progress/status calculations, workspace drawer content, and both `/studio` links. Preserve the existing responsive navigation dialog, focus trap, Escape behavior, project links, Settings, and Sign out.

- [ ] **Step 4: Remove archive loading from Projects**

Delete the `creative-api` import, all `legacy*` state/effects/retry code, and return only `currentProjects`:

```tsx
return currentProjects;
```

Delete `.legacySection`, `.legacyList`, `.legacyPage`, `.legacyPanel`, `.legacySliders`, `.legacyCards`, `.legacyPalette`, `.legacyChannels`, and `.legacyArtifact` CSS rules. Remove shell rules used exclusively by the old brief/DNA/outputs workspace after an `rg` usage check.

- [ ] **Step 5: Delete routes/code and remove proxy rewrites**

Delete all listed old pages, components, API client, and `guided-workspace.spec.ts`. Remove the `/api/creative/:path*` rewrite from `client/next.config.ts`. Change the proxy matcher and its quality assertion to:

```typescript
matcher: ["/settings/:path*", "/projects/:path*"]
```

Remove `readyUser` from `e2e/helpers/session.ts` if no remaining caller uses it. Delete legacy-only tests from `e2e/projects.spec.ts`; preserve project listing, diagnostic, owner isolation, responsive rows, and failure recovery coverage.

- [ ] **Step 6: Verify GREEN and absence**

```bash
npx playwright test e2e/production-surface.spec.ts e2e/projects.spec.ts e2e/auth-quality.spec.ts
rg -n 'href="/studio"|/projects/legacy|api/creative|Legacy workspace|Legacy sessions|WorkspaceProvider' app e2e next.config.ts proxy.ts
```

Expected: focused Playwright tests PASS; `rg` returns no active runtime reference.

- [ ] **Step 7: Commit client removal**

```bash
git add client
git commit -m "refactor(client): remove legacy workspace surfaces"
```

### Task 3: Build validated cross-domain browser history

**Files:**
- Create: `client/app/components/constellation/workspace-history.ts`
- Create: `client/app/components/constellation/workspace-history.test.ts`
- Delete: `client/app/components/constellation/semantic-history.ts`
- Delete: `client/app/components/constellation/semantic-history.test.ts`
- Modify: `client/app/lib/project-annotations.ts`
- Modify: `client/app/lib/project-annotations.test.ts`

- [ ] **Step 1: Write failing pure-history tests**

Create fixtures for one semantic node command and one annotation snapshot command, then assert chronology, bounds, validation, and commit-after-success semantics:

```typescript
it("undoes and redoes graph and annotation commands in one chronology", () => {
  const history = recordWorkspaceCommand(
    recordWorkspaceCommand(emptyWorkspaceHistory(), graphCommand),
    annotationCommand,
  );
  expect(undoCandidate(history)).toEqual(annotationCommand);
  const afterAnnotationUndo = commitWorkspaceUndo(history);
  expect(undoCandidate(afterAnnotationUndo)).toEqual(graphCommand);
  expect(redoCandidate(afterAnnotationUndo)).toEqual(annotationCommand);
  expect(redoCandidate(commitWorkspaceRedo(afterAnnotationUndo))).toBeNull();
});

it("does not move a command until commit is called", () => {
  const history = recordWorkspaceCommand(emptyWorkspaceHistory(), annotationCommand);
  expect(undoCandidate(history)).toEqual(annotationCommand);
  expect(undoCandidate(history)).toEqual(annotationCommand);
});
```

Also assert a 50-command total cap, new-command redo clearing, owner/project rejection, malformed annotation rejection, storage denial safety, and exact schema keys.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm run test:unit -- --run app/components/constellation/workspace-history.test.ts
```

Expected: FAIL because `workspace-history.ts` does not exist.

- [ ] **Step 3: Implement the history types and pure transitions**

Use explicit domain envelopes:

```typescript
export const MAX_WORKSPACE_HISTORY = 50;

export type SemanticCommand =
  | Readonly<{ kind: "node"; node: GraphNode }>
  | Readonly<{ kind: "edge"; edge: GraphEdge }>;

export type WorkspaceCommand = Readonly<{
  schemaVersion: 1;
  ownerId: string;
  projectId: string;
  createdAt: number;
  action:
    | Readonly<{ domain: "graph"; command: SemanticCommand }>
    | Readonly<{
        domain: "annotation";
        before: readonly CanvasAnnotation[];
        after: readonly CanvasAnnotation[];
      }>;
}>;

export type WorkspaceHistory = Readonly<{
  past: readonly WorkspaceCommand[];
  future: readonly WorkspaceCommand[];
}>;
```

Implement `emptyWorkspaceHistory`, `recordWorkspaceCommand`, `undoCandidate`, `redoCandidate`, `commitWorkspaceUndo`, `commitWorkspaceRedo`, `loadWorkspaceHistory`, and `saveWorkspaceHistory`. `past` and `future` are stacks whose active candidate is `.at(-1)`. `recordWorkspaceCommand` appends to `past`, bounds the combined total to 50, and clears `future`.

Strictly validate exact keys, schema version, finite positive timestamps, matching owner/project IDs, graph node/edge records, and every annotation field. On invalid storage, remove the key safely and return empty history with `persistenceAvailable: false`.

- [ ] **Step 4: Reduce annotation state to persisted data only**

Replace the independent annotation history with:

```typescript
export type AnnotationState = Readonly<{ annotations: readonly CanvasAnnotation[] }>;
export type AnnotationAction = Readonly<{
  type: "replace" | "clear";
  annotations?: readonly CanvasAnnotation[];
}>;
```

`reduceAnnotationAction` must only replace or clear annotations. Cross-domain history now owns undo/redo chronology.

- [ ] **Step 5: Run unit tests and verify GREEN**

```bash
npm run test:unit -- --run app/components/constellation/workspace-history.test.ts app/lib/project-annotations.test.ts
```

Expected: both files PASS with cross-domain chronology and data-only annotation reducer coverage.

- [ ] **Step 6: Commit the history model**

```bash
git add client/app/components/constellation client/app/lib/project-annotations.ts client/app/lib/project-annotations.test.ts
git commit -m "feat(client): add unified workspace history"
```

### Task 4: Integrate unified history with graph and annotation persistence

**Files:**
- Modify: `client/app/components/constellation/constellation-editor.tsx`
- Modify: `client/e2e/constellation.spec.ts`

- [ ] **Step 1: Write the failing chronological E2E test**

Add a test that creates a thought, draws one annotation, then exercises the single history in order:

```typescript
test("one history pair follows graph and annotation chronology", async ({ page }) => {
  await openConstellation(page);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByText("New thought", { exact: true })).toBeVisible();
  await drawStroke(page);
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
  await expect(page.getByText("New thought", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("New thought", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("New thought", { exact: true })).toBeVisible();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);
});
```

Add a route failure assertion: when annotation undo persistence fails, the annotation remains visible and Undo stays enabled.

- [ ] **Step 2: Run the E2E test and verify RED**

```bash
npx playwright test e2e/constellation.spec.ts -g "one history pair"
```

Expected: FAIL because the toolbar exposes separate histories and cannot preserve cross-domain order.

- [ ] **Step 3: Replace semantic refs with workspace history state**

Use one state/ref pair so button disabled state renders immediately while async handlers read the latest value:

```typescript
const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceHistory>(emptyWorkspaceHistory);
const workspaceHistoryRef = useRef(workspaceHistory);
const setHistory = useCallback((next: WorkspaceHistory) => {
  workspaceHistoryRef.current = next;
  setWorkspaceHistory(next);
}, []);
```

Load and save key `creative-curator:workspace-history:v1:${user.id}:${initial.project.id}`. Preserve the existing reduced-durability notice, changing its text to `Undo history remains available only until this tab closes.`

Create a single recorder that builds the owner/project envelope, updates state/ref together, and persists the result:

```typescript
const recordHistory = useCallback((action: WorkspaceCommand["action"]) => {
  if (!user) return;
  const command: WorkspaceCommand = {
    schemaVersion: 1,
    ownerId: user.id,
    projectId: initial.project.id,
    createdAt: Date.now(),
    action,
  };
  const next = recordWorkspaceCommand(workspaceHistoryRef.current, command);
  setHistory(next);
  persistWorkspaceHistory(next);
}, [initial.project.id, persistWorkspaceHistory, setHistory, user]);
```

- [ ] **Step 4: Record successful semantic and annotation actions**

After successful node/edge creation, record a `graph` envelope. Introduce one annotation mutation helper:

```typescript
const applyAnnotationChange = useCallback(async (
  before: readonly CanvasAnnotation[],
  after: readonly CanvasAnnotation[],
  cleanup: readonly { media_id: string; upload_claim: string }[] = [],
) => {
  await persistAnnotations(after, cleanup);
  annotationDispatch({ type: "replace", annotations: after });
  recordHistory({ domain: "annotation", before, after });
}, [persistAnnotations, recordHistory]);
```

Use it for finished freehand strokes, erase actions, and successful media placement. Failed optimistic semantic actions and failed annotation persistence must not enter history.

- [ ] **Step 5: Implement one asynchronous Undo and Redo dispatcher**

`undoWorkspace` reads `undoCandidate`. For `graph`, run the existing node-trash/edge-delete logic; for `annotation`, persist `command.action.before` and only then dispatch replacement. Call `commitWorkspaceUndo` only after success. `redoWorkspace` mirrors this with node restore/edge create or `command.action.after`, then calls `commitWorkspaceRedo`.

On failure, do not alter history state. Preserve graph queue/recovery behavior and set either semantic or annotation status to `Needs attention` with an owning-domain message.

- [ ] **Step 6: Verify GREEN and reload durability**

```bash
npx playwright test e2e/constellation.spec.ts -g "history pair|history storage denial|undo|redo"
npm run test:unit -- --run app/components/constellation/workspace-history.test.ts app/lib/project-annotations.test.ts
```

Expected: chronological actions, failed inverse retention, reload, storage denial, and pure history tests PASS.

- [ ] **Step 7: Commit integration**

```bash
git add client/app/components/constellation/constellation-editor.tsx client/e2e/constellation.spec.ts
git commit -m "feat(client): unify canvas undo and redo"
```

### Task 5: Build the compact icon-only toolbar and tooltips

**Files:**
- Create: `client/app/components/constellation/canvas-toolbar.test.tsx`
- Modify: `client/app/components/constellation/canvas-toolbar.tsx`
- Modify: `client/app/components/constellation/constellation.css`
- Modify: `client/app/components/constellation/constellation-editor.tsx`

- [ ] **Step 1: Write failing toolbar component tests**

```tsx
render(<CanvasToolbar
  canRedo={false}
  canUndo
  mode="select"
  onAddMedia={vi.fn()}
  onAddThought={vi.fn()}
  onMode={vi.fn()}
  onRedo={vi.fn()}
  onUndo={vi.fn()}
/>);

expect(screen.getAllByRole("button")).toHaveLength(8);
expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
expect(screen.queryByText("Select")).toBeNull();
await user.hover(screen.getByRole("button", { name: "Select" }));
expect(screen.getByRole("tooltip")).toHaveTextContent("Select");
await user.keyboard("{Escape}");
expect(screen.queryByRole("tooltip")).toBeNull();
```

Also focus `Draw`, assert its tooltip, blur it, and assert dismissal. Assert there is no `Keyboard graph controls` button and no duplicated graph/annotation history labels.

- [ ] **Step 2: Run unit test and verify RED**

```bash
npm run test:unit -- --run app/components/constellation/canvas-toolbar.test.tsx
```

Expected: FAIL because the current toolbar renders text, 11 controls, duplicate history pairs, and the keyboard console.

- [ ] **Step 3: Implement the eight-button dock**

Keep the four Lucide mode icons and use `Plus`, `ImagePlus`, `Undo2`, and `Redo2`. Replace the prop contract with:

```typescript
type CanvasToolbarProps = Readonly<{
  mode: CanvasMode;
  canUndo: boolean;
  canRedo: boolean;
  onMode: (mode: CanvasMode) => void;
  onAddThought: () => void;
  onAddMedia: () => void;
  onUndo: () => void;
  onRedo: () => void;
}>;
```

Create a local `ToolButton` that uses `aria-label`, `aria-describedby`, `aria-pressed` for modes, and a conditionally rendered `<span role="tooltip">`. Open on pointer enter or focus; dismiss on pointer leave, blur, or Escape. Render mode, creation, and history groups separated by two `aria-hidden` dividers.

- [ ] **Step 4: Replace scrollable toolbar CSS with fixed geometry**

```css
.canvas-toolbar {
  position: absolute;
  z-index: 5;
  left: 50%;
  bottom: 18px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  transform: translateX(-50%);
  overflow: visible;
}
.canvas-toolbar button {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  padding: 0;
  justify-content: center;
}
.canvas-toolbar__tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  white-space: nowrap;
}
```

Retain opaque theme surfaces, 3:1 focus indicator contrast, selected state, and restrained shadow. Remove `.canvas-toolbar__keyboard` rules and the 900px horizontal-scroll override.

- [ ] **Step 5: Wire one history pair**

Pass `canUndo={workspaceHistory.past.length > 0}`, `canRedo={workspaceHistory.future.length > 0}`, `onUndo={undoWorkspace}`, and `onRedo={redoWorkspace}`. Remove node lists, resize props, connect props, and separate graph/annotation callbacks.

- [ ] **Step 6: Verify GREEN**

```bash
npm run test:unit -- --run app/components/constellation/canvas-toolbar.test.tsx
npx tsc --noEmit
```

Expected: toolbar tests PASS and TypeScript reports zero errors.

- [ ] **Step 7: Commit toolbar**

```bash
git add client/app/components/constellation
git commit -m "feat(client): compact the canvas toolbar"
```

### Task 6: Move precise connection and sizing into the Inspector

**Files:**
- Modify: `client/app/components/constellation/node-inspector.tsx`
- Modify: `client/app/components/constellation/constellation-actions.test.tsx`
- Modify: `client/app/components/constellation/constellation-editor.tsx`
- Modify: `client/app/components/constellation/constellation.css`

- [ ] **Step 1: Write failing Inspector tests**

Render a selected node with `width={244}`, `height={124}`, `onResize`, `onConnect`, and available nodes. Assert labeled sections and failure retention:

```tsx
expect(screen.getByRole("heading", { name: "Connect nodes" })).toBeVisible();
expect(screen.getByRole("heading", { name: "Size & position" })).toBeVisible();
await user.clear(screen.getByLabelText("Node width"));
await user.type(screen.getByLabelText("Node width"), "320");
await user.clear(screen.getByLabelText("Node height"));
await user.type(screen.getByLabelText("Node height"), "180");
await user.click(screen.getByRole("button", { name: "Apply node size" }));
expect(onResize).toHaveBeenCalledWith(320, 180);
```

Reject `onResize`, then assert both entered values remain and the live region says `Node size was not saved. Values preserved.` Assert bounds of width 208–1200 and height 112–900.

- [ ] **Step 2: Run test and verify RED**

```bash
npm run test:unit -- --run app/components/constellation/constellation-actions.test.tsx
```

Expected: FAIL because the Inspector has no sizing section and connection heading remains generic.

- [ ] **Step 3: Extend the Inspector contract**

Add required geometry and optional async resize callback:

```typescript
width: number;
height: number;
onResize?: (width: number, height: number) => Promise<void>;
```

Rename the relationship action heading to `Connect nodes`. Add `Size & position` with bounded number inputs, `Apply node size`, and an `aria-live="polite"` status. Preserve values after rejection and clear only the status when the user edits again.

- [ ] **Step 4: Return a real layout promise from the editor**

Refactor `resizeNode` to return the queued `api.saveLayout` promise for the selected node instead of fire-and-forget timing. Pass the selected React Flow node's measured/fallback width and height plus:

```tsx
onResize={(width, height) => resizeNode(selectedNode.id, width, height)}
```

Keep layout version compare-and-swap, bounded dimensions, `Saving`/`Saved`/`Needs attention`, and the user's selected node on failure.

- [ ] **Step 5: Verify GREEN**

```bash
npm run test:unit -- --run app/components/constellation/constellation-actions.test.tsx
npx tsc --noEmit
```

Expected: Inspector connection, sizing, failure retention, and type checks PASS.

- [ ] **Step 6: Commit Inspector controls**

```bash
git add client/app/components/constellation
git commit -m "feat(client): move precise graph controls to inspector"
```

### Task 7: Prove responsive, accessible, theme-stable behavior

**Files:**
- Modify: `client/e2e/constellation.spec.ts`
- Modify: `client/e2e/constellation-mobile.spec.ts`
- Modify: `client/app/components/constellation/constellation.css`

- [ ] **Step 1: Add the failing desktop geometry and tooltip test**

For Paper, Graphite, and Project at 1280×800 and 1024×768, assert:

```typescript
const toolbar = page.getByRole("toolbar", { name: "Canvas tools" });
const box = await toolbar.boundingBox();
expect(box).not.toBeNull();
expect(box!.x).toBeGreaterThanOrEqual(0);
expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
expect(await toolbar.getByRole("button").count()).toBe(8);
for (const button of await toolbar.getByRole("button").all()) {
  const size = await button.boundingBox();
  expect(size?.width).toBe(44);
  expect(size?.height).toBe(44);
}
```

Tab to every control, assert the matching tooltip and visible focus, press Escape, and assert dismissal. Assert no resting button has visible label text.

- [ ] **Step 2: Add mobile absence/preservation coverage and verify RED**

Assert the desktop `Canvas tools` toolbar is absent at 390×844 while node focus, traversal, capture, Hermes challenge, and Blueprint actions remain available.

```bash
npx playwright test e2e/constellation.spec.ts e2e/constellation-mobile.spec.ts -g "compact toolbar|mobile focus"
```

Expected: desktop geometry/tooltip test fails against the old overflow behavior; mobile baseline remains diagnostic.

- [ ] **Step 3: Correct only measured responsive defects**

Use the E2E bounding boxes to adjust fixed gaps, dividers, tooltip collision bounds, and canvas bottom inset. Do not shrink below 44px, restore visible text, add horizontal scrolling, or render the dock in mobile focus mode.

- [ ] **Step 4: Verify GREEN in all themes/viewports**

```bash
npx playwright test e2e/constellation.spec.ts e2e/constellation-mobile.spec.ts -g "compact toolbar|mobile focus|history pair"
```

Expected: all theme/viewport, tooltip/focus, chronology, and mobile preservation assertions PASS.

- [ ] **Step 5: Commit responsive behavior**

```bash
git add client/app/components/constellation/constellation.css client/e2e/constellation.spec.ts client/e2e/constellation-mobile.spec.ts
git commit -m "test(client): lock compact toolbar behavior"
```

### Task 8: Synchronize authoritative documentation and CI contracts

**Files:**
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `README.md`
- Modify: `docs/CLIENT_FLOW.md`
- Modify: `docs/API.md`
- Modify: `docs/SUPABASE.md`
- Modify: `docs/DEVLOG.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/INDEX.md`
- Modify: `backend/tests/test_spatial_documentation.py`
- Modify: `backend/tests/test_ci_workflow.py` only if test commands or job contracts change

- [ ] **Step 1: Rewrite documentation contract tests to RED**

Replace legacy-preservation assertions with production-only assertions:

```python
def test_docs_define_constellation_only_production_runtime(self) -> None:
    combined = "\n".join(self.read(path) for path in (
        "PRODUCT.md", "DESIGN.md", "README.md", "docs/CLIENT_FLOW.md", "docs/API.md",
    ))
    self.assertNotIn("Legacy workspace", combined)
    self.assertNotIn("GET /creative/sessions", combined)
    self.assertIn("one chronological Undo and Redo history", combined)
    self.assertIn("icon-only", combined)

def test_supabase_retains_historical_rows_without_runtime_access(self) -> None:
    contract = self.read("docs/SUPABASE.md")
    self.assertIn("historical creative_sessions rows are retained", contract)
    self.assertIn("no runtime route reads or mutates them", contract)
```

- [ ] **Step 2: Run documentation tests and verify RED**

```bash
.venv/bin/python -m unittest tests.test_spatial_documentation -v
```

Expected: FAIL because authoritative docs still promise `/studio`, legacy archive routes, and separate histories.

- [ ] **Step 3: Update every owning document**

Make these exact contract changes:

- `PRODUCT.md`: Brand Constellation is the sole production journey; remove the legacy-return step.
- `DESIGN.md`: record the eight-button icon-only dock, hover/focus tooltips, Inspector operations, and one chronological history.
- `README.md`: remove `/studio`, legacy routes, and guided-session description.
- `docs/CLIENT_FLOW.md`: delete historical campaign-session sections; specify unified history execution and toolbar geometry.
- `docs/API.md`: remove every `/creative/*` route and session-state contract.
- `docs/SUPABASE.md`: retain historical `creative_sessions` rows/migration definitions while stating no runtime access; do not add a destructive migration.
- `docs/DEVLOG.md` and `docs/CHANGELOG.md`: record removal, migration safety, RED/GREEN commands, and final counts.
- `docs/INDEX.md`: index the approved design and this plan.

Do not rewrite the already-approved 2026-07-26 historical spec/plan; they remain dated project history. The new design and implementation plan supersede their legacy-runtime and toolbar clauses.

- [ ] **Step 4: Verify GREEN and CI alignment**

```bash
.venv/bin/python -m unittest tests.test_spatial_documentation tests.test_ci_workflow -v
```

Expected: documentation and CI contract tests PASS. If mandatory commands did not change, `.github/workflows/ci.yml` and `test_ci_workflow.py` remain unchanged.

- [ ] **Step 5: Commit synchronized docs**

```bash
git add PRODUCT.md DESIGN.md README.md docs backend/tests/test_spatial_documentation.py
git commit -m "docs: make constellation the production workspace"
```

### Task 9: Refresh production-only visual evidence

**Files:**
- Modify: `docs/evidence/spatial-brand-workspace/README.md`
- Modify/Delete: `docs/evidence/spatial-brand-workspace/*.png`

- [ ] **Step 1: Remove obsolete legacy evidence references and files**

Delete screenshots whose only subject is `/studio` or `/projects/legacy/*`. Remove their entries from the evidence index. Keep public landing, sign-in, Projects, diagnostics, constellation, Hermes, Blueprint, Settings, reduced-motion, annotation, and media evidence.

- [ ] **Step 2: Capture the compact dock in all themes**

At 1440×1000, capture Paper, Graphite, and Project with:

- the complete dock visible without clipping;
- Select active;
- one tooltip visible from keyboard focus;
- exactly one Undo/Redo pair; and
- selected-node Inspector showing `Connect nodes` and `Size & position`.

At 390×844, capture the mobile focus workflow in all themes and confirm the desktop dock is absent.

- [ ] **Step 3: Inspect every new image directly**

Use image inspection to confirm opaque theme surfaces, readable focus/tooltip contrast, no overflow, no duplicated arrows, no legacy navigation, and no stale browser/test artifacts. Record exact viewport, theme, route, and scenario in the evidence index.

- [ ] **Step 4: Commit evidence**

```bash
git add docs/evidence/spatial-brand-workspace
git commit -m "docs: refresh production workspace evidence"
```

### Task 10: Run complete verification and prepare the existing PR

**Files:**
- Modify: `docs/DEVLOG.md` if final measured counts differ from Task 8
- Modify: pull request body for exact final verification/evidence

- [ ] **Step 1: Run the complete backend gate**

From `backend` using Python 3.11+:

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Expected: all active backend tests PASS; only guarded local Supabase tests may skip when explicit loopback variables are absent; zero failures/errors.

- [ ] **Step 2: Run client unit, lint, and type gates**

From `client`:

```bash
npm run test:unit -- --run
npm run lint
npx tsc --noEmit
```

Expected: every unit test passes, ESLint reports zero findings, and TypeScript reports zero errors.

- [ ] **Step 3: Run production build and full browser gate serially**

```bash
npm run build
npm run test:e2e
```

Expected: production build succeeds and every Playwright test passes with zero failures. Do not run lint concurrently with Playwright because Playwright recreates `client/test-results`.

- [ ] **Step 4: Audit removal and repository cleanliness**

```bash
rg -n 'href="/studio"|/projects/legacy|/api/creative|/creative/sessions|Legacy workspace|Legacy sessions|WorkspaceProvider' backend/app client/app client/e2e README.md PRODUCT.md DESIGN.md docs --glob '!docs/superpowers/specs/2026-07-26-*' --glob '!docs/superpowers/plans/2026-07-26-*'
git diff --check
git status --short
```

Expected: no active legacy runtime/doc references outside dated historical inputs and explicit retention language; no whitespace errors; only intentional tracked changes before the final commit.

- [ ] **Step 5: Record exact evidence and commit any final doc correction**

Write exact commands, test counts, guarded skips, failures, theme/viewports, and confirmation that no remote Supabase/provider operation ran. If counts changed:

```bash
git add docs/DEVLOG.md docs/evidence/spatial-brand-workspace/README.md
git commit -m "docs: record production workspace verification"
```

- [ ] **Step 6: Push and update—but do not merge—the existing PR**

```bash
git push origin codex/spatial-brand-workspace
gh pr edit 5 --body-file /tmp/creative-curator-pr-body.md
gh pr checks 5 --watch --interval 10
```

Expected: PR #5 targets `main`, remains open and unmerged, reports exact local verification and evidence, and all required CI checks pass.
