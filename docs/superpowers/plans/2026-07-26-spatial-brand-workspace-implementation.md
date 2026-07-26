# Spatial Brand Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed new-session journey with a versioned, owner-scoped Brand Constellation that Hermes can challenge and compile into an interactive Starter Brand Blueprint and dated PDF snapshot.

**Architecture:** Add a typed project-graph domain beside the legacy creative-session domain, persist semantic graph state separately from canvas layout and annotations, and expose version-checked FastAPI endpoints. Hermes analyzes only relevant subgraphs, caches structured responses by dependency versions, and stores suggestions as proposals until atomic user acceptance. The Next.js client uses React Flow for canvas mechanics, an isolated annotation layer for freehand/media content, Motion for meaningful transitions, and token-driven workbench components derived from the `ui-updates` prototype without inheriting its local-state architecture.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, Supabase/Postgres, Next.js 16, React 19, TypeScript, Tailwind CSS 4, `@xyflow/react`, `perfect-freehand`, Lucide React, Motion for React, shadcn-compatible local UI structure, Vitest, Testing Library, Playwright.

---

## Execution rules

- Work only on `codex/spatial-brand-workspace-design` or a fresh implementation branch created from it. Do not implement on `main` or `codex/provider-structured-output`.
- Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, and `docs/superpowers/specs/2026-07-26-spatial-brand-workspace-design.md` before editing behavior.
- Follow RED → GREEN for every behavior change. Record the failing command before production code.
- Keep legacy creative sessions operational until the final cutover task.
- Never run remote Supabase commands. Migrations and integration tests may target only `localhost` or `127.0.0.1`.
- Review every 21st.dev component's source, author, license, dependencies, accessibility, and performance before copying it. Record accepted components in `docs/COMPONENT_PROVENANCE.md`.
- Keep autonomous external research out of the MVP; Hermes may only label evidence gaps and suggest research questions from user-supplied project material.
- Preserve WCAG 2.2 AA as the minimum contrast, keyboard, focus, motion, and status-communication target.
- Run the affected suite after each task and all project gates before handoff.

## Preparation checkpoint

- [ ] Confirm `git branch --show-current` prints `codex/spatial-brand-workspace-design` or a fresh `codex/` implementation branch created from it.
- [ ] From `backend/`, create the ignored Python environment with `python3.11 -m venv .venv` and install `python -m pip install -r requirements.txt`.
- [ ] From `client/`, run `npm ci` and `npx playwright install chromium`.
- [ ] Run `cd backend && .venv/bin/python -m unittest discover -s tests -v`; expect 241 tests and only the three documented local-Supabase skips at the design baseline.
- [ ] Run `cd client && npm run lint && npx tsc --noEmit && npm run build && npm run test:e2e`; expect 59 Playwright tests at the design baseline.
- [ ] Stop if the baseline differs. Diagnose it before writing a failing feature test.

## Target file structure

### Backend

- `backend/app/projects/types.py` — immutable project, node, edge, annotation, media, proposal, challenge, and Blueprint domain types
- `backend/app/projects/store.py` — `ProjectStore` protocol and in-memory implementation
- `backend/app/projects/supabase_store.py` — Supabase implementation and safe error mapping
- `backend/app/projects/service.py` — graph invariants, version checks, revisions, trash, and atomic proposal acceptance
- `backend/app/projects/analysis.py` — relevant-subgraph selection, cache fingerprints, and Hermes proposal orchestration
- `backend/app/projects/blueprint.py` — readiness calculation and immutable Blueprint compilation
- `backend/app/api/projects.py` — authenticated project, graph, analysis, proposal, and Blueprint HTTP contract
- `backend/app/llm/schemas.py` — strict Hermes graph-analysis output schemas
- `backend/app/composition.py` — project store and service composition
- `backend/tests/test_project_store.py` — store and owner-isolation behavior
- `backend/tests/test_project_service.py` — graph invariants, versions, proposals, trash, and cache behavior
- `backend/tests/test_projects_api.py` — authenticated API, bounded media-upload contract, and safe errors
- `backend/tests/test_project_blueprint.py` — readiness and deterministic snapshot compilation
- `backend/tests/test_supabase_projects.py` — guarded local persistence integration and SQL contract

### Persistence

- `supabase/migrations/20260726090000_add_spatial_brand_projects.sql` — owner-scoped project graph schema and atomic RPCs
- `supabase/manual/rollback_spatial_brand_projects.sql` — local manual rollback helper

### Client

- `client/components.json` — shadcn-compatible aliases and Tailwind configuration
- `client/app/lib/utils.ts` — shared `cn` helper
- `client/app/lib/projects-api.ts` — typed project API client and safe error mapping
- `client/app/lib/project-types.ts` — client graph, annotation, proposal, challenge, Blueprint, and theme types
- `client/app/lib/project-graph.ts` — pure semantic graph reducers, undo/redo, proposal previews, and readiness selectors
- `client/app/lib/project-annotations.ts` — isolated annotation reducers and undo/redo
- `client/app/lib/project-theme.ts` — Paper, Graphite, and Project theme selection and safe token derivation
- `client/app/lib/pending-project-edits.ts` — bounded local pending-edit queue
- `client/app/components/ui/*` — reviewed local primitives derived from the `ui-updates` workbench and any approved external source
- `client/app/components/projects/project-list.tsx` — project home
- `client/app/components/projects/project-diagnostic.tsx` — adaptive project creation
- `client/app/components/constellation/constellation-editor.tsx` — React Flow integration and viewport state
- `client/app/components/constellation/nodes/*` — typed custom nodes
- `client/app/components/constellation/edges/*` — semantic custom edges
- `client/app/components/constellation/annotation-layer.tsx` — freehand and decorative-media overlay synchronized to the viewport
- `client/app/components/constellation/canvas-toolbar.tsx` — select, connect, draw, erase, note, and media tools
- `client/app/components/constellation/project-map-panel.tsx` — clusters, branches, filters, and layers
- `client/app/components/constellation/node-inspector.tsx` — node editing, connections, history, and challenges
- `client/app/components/constellation/command-surface.tsx` — quick capture and guided exploration
- `client/app/components/constellation/proposal-tray.tsx` — proposal preview and acceptance
- `client/app/components/constellation/accessible-graph.tsx` — equivalent tree/list interaction
- `client/app/components/blueprint/brand-blueprint.tsx` — interactive and print-friendly Blueprint
- `client/app/(protected)/projects/page.tsx` — Projects route
- `client/app/(protected)/projects/new/page.tsx` — diagnostic route
- `client/app/(protected)/projects/[projectId]/page.tsx` — constellation route
- `client/app/(protected)/projects/[projectId]/blueprint/page.tsx` — Blueprint route
- `client/app/styles/workbench.css` — Paper, Graphite, and Project workbench themes
- `client/app/styles/constellation.css` — graph, annotation, zoom, and interaction states
- `client/app/styles/print.css` — PDF/print layout
- `client/vitest.config.ts` and `client/test/setup.ts` — client unit-test setup
- `client/e2e/projects.spec.ts` — project and diagnostic behavior
- `client/e2e/constellation.spec.ts` — desktop graph and Hermes journey
- `client/e2e/constellation-mobile.spec.ts` — focused mobile graph journey
- `client/e2e/blueprint.spec.ts` — Blueprint and print snapshot behavior

### Documentation

- `PRODUCT.md`, `DESIGN.md`, `README.md`
- `docs/CLIENT_FLOW.md`, `docs/API.md`, `docs/SUPABASE.md`, `docs/DEVLOG.md`
- `docs/COMPONENT_PROVENANCE.md`

---

### Task 1: Define the project-graph domain

**Files:**
- Create: `backend/app/projects/__init__.py`
- Create: `backend/app/projects/types.py`
- Test: `backend/tests/test_project_types.py`

- [ ] **Step 1: Write failing type and invariant tests**

```python
from dataclasses import FrozenInstanceError
import unittest

from app.projects.types import GraphEdge, GraphNode, Project, ProjectStatus


class ProjectTypeTests(unittest.TestCase):
    def test_nodes_are_typed_frozen_and_trim_content(self) -> None:
        node = GraphNode.create(
            project_id="project-a",
            node_type="assumption",
            title=" Audience belief ",
            content=" They value calm. ",
            created_by="user",
        )
        self.assertEqual(node.title, "Audience belief")
        self.assertEqual(node.version, 1)
        with self.assertRaises(FrozenInstanceError):
            node.title = "changed"  # type: ignore[misc]

    def test_edge_rejects_self_reference(self) -> None:
        with self.assertRaisesRegex(ValueError, "distinct"):
            GraphEdge.create("project-a", "node-a", "node-a", "supports")

    def test_project_starts_active_at_version_one(self) -> None:
        project = Project.create("user-a", "Untitled brand")
        self.assertEqual(project.status, ProjectStatus.ACTIVE)
        self.assertEqual(project.version, 1)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_types -v`  
Expected: `ModuleNotFoundError: No module named 'app.projects'`.

- [ ] **Step 3: Implement strict immutable domain types**

Create enums for `NodeType`, `NodeState`, `EdgeType`, `AnnotationType`, `CreationSource`, `ChallengeState`, `ProposalState`, `ProjectStatus`, and `ThemeChoice`. Use frozen dataclasses with explicit factories that trim text, reject blank identifiers, initialize version `1`, and produce UTC ISO timestamps. Define `Project`, `GraphNode`, `GraphEdge`, `CanvasAnnotation`, `CanvasMedia`, `NodeRevision`, `AnalysisProposal`, `ChallengeResolution`, and `BlueprintSnapshot` with no mutable collection aliases. `CanvasAnnotation` permits freehand paths and owner-scoped decorative `media_id` references but cannot embed data URLs, use semantic node types, edge relationships, evidence provenance, or approval state. `CanvasMedia` records owner, project, opaque storage key, MIME type, byte length, SHA-256, and timestamps without exposing a filesystem or bucket path to another owner.

Use a shared rejecting normalizer and implement the factories with concrete construction rather than permissive coercion:

```python
def _required(value: str, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{label} is required")
    return cleaned

@dataclass(frozen=True)
class GraphNode:
    id: str
    project_id: str
    node_type: NodeType
    title: str
    content: str
    created_by: CreationSource
    provenance: str | None
    state: NodeState
    version: int
    created_at: str
    updated_at: str

    @classmethod
    def create(
        cls,
        project_id: str,
        node_type: NodeType | str,
        title: str,
        content: str,
        created_by: CreationSource | str,
        *,
        provenance: str | None = None,
    ) -> "GraphNode":
        now = _utc_now()
        return cls(
            id=str(uuid4()),
            project_id=_required(project_id, "project_id"),
            node_type=NodeType(node_type),
            title=_required(title, "title"),
            content=_required(content, "content"),
            created_by=CreationSource(created_by),
            provenance=provenance.strip() if provenance and provenance.strip() else None,
            state=NodeState.WORKING,
            version=1,
            created_at=now,
            updated_at=now,
        )

@dataclass(frozen=True)
class GraphEdge:
    @classmethod
    def create(
        cls,
        project_id: str,
        source_node_id: str,
        target_node_id: str,
        edge_type: EdgeType | str,
    ) -> "GraphEdge":
        source = _required(source_node_id, "source_node_id")
        target = _required(target_node_id, "target_node_id")
        if source == target:
            raise ValueError("edge nodes must be distinct")
        return cls(
            id=str(uuid4()),
            project_id=_required(project_id, "project_id"),
            source_node_id=source,
            target_node_id=target,
            edge_type=EdgeType(edge_type),
            version=1,
            created_at=_utc_now(),
        )
```

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_types -v`  
Expected: all project type tests pass with zero skips.

- [ ] **Step 5: Commit the domain types**

```bash
git add backend/app/projects backend/tests/test_project_types.py
git commit -m "feat(projects): define typed brand graph domain"
```

### Task 2: Add the owner-scoped in-memory project store

**Files:**
- Create: `backend/app/projects/store.py`
- Test: `backend/tests/test_project_store.py`

- [ ] **Step 1: Write failing store contract tests**

```python
import unittest

from app.projects.store import InMemoryProjectStore, VersionConflict
from app.projects.types import GraphNode, Project


class InMemoryProjectStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = InMemoryProjectStore()
        self.project = Project.create("user-a", "New brand")
        self.store.create_project(self.project)

    def test_project_is_owner_scoped_and_returns_copies(self) -> None:
        self.assertIsNotNone(self.store.get_project("user-a", self.project.id))
        self.assertIsNone(self.store.get_project("user-b", self.project.id))

    def test_node_compare_and_swap_rejects_stale_version(self) -> None:
        node = GraphNode.create(self.project.id, "idea", "Thought", "Content", "user")
        self.store.create_node("user-a", node)
        self.store.update_node("user-a", node, expected_version=1)
        with self.assertRaises(VersionConflict):
            self.store.update_node("user-a", node, expected_version=1)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_store -v`  
Expected: import failure for `app.projects.store`.

- [ ] **Step 3: Implement the store protocol and in-memory store**

Define a `ProjectStore` protocol with owner-scoped methods for projects, nodes, edges, revisions, proposals, analyses, snapshots, layout positions, annotations, media metadata/content, global theme preference, and per-project theme override. Implement `InMemoryProjectStore` with one `RLock`, deep-copy boundaries, deterministic list ordering, and compare-and-swap versions. Add typed `ProjectNotFound`, `GraphItemNotFound`, `VersionConflict`, `InvalidMedia`, and `StoreFailure` exceptions.

The semantic methods must not accept unverified user IDs from stored payloads; every read and mutation receives the authenticated `user_id` separately.

- [ ] **Step 4: Verify owner isolation, copies, ordering, and conflicts**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_store -v`  
Expected: all store tests pass.

- [ ] **Step 5: Commit the store**

```bash
git add backend/app/projects/store.py backend/tests/test_project_store.py
git commit -m "feat(projects): add owner-scoped graph store"
```

### Task 3: Implement graph service invariants and revisions

**Files:**
- Create: `backend/app/projects/service.py`
- Test: `backend/tests/test_project_service.py`

- [ ] **Step 1: Write failing service tests**

Cover project creation, quick capture, same-project edges, duplicate-edge rejection, semantic node updates, immutable revisions, soft delete and restore, separate layout updates, isolated annotation create/update/delete, theme preference/override, and stale project versions. Prove annotation writes leave project semantic version, nodes, edges, revisions, analysis dependencies, and Blueprint readiness unchanged.

```python
def test_semantic_update_creates_revision_and_increments_versions(self) -> None:
    project = self.service.create_project("user-a", "New brand")
    node = self.service.create_node(
        "user-a", project.id, "idea", "Audience", "Busy renters", "user", project.version
    )
    updated = self.service.update_node(
        "user-a", project.id, node.id, "Audience", "First-time renters", node.version
    )
    self.assertEqual(updated.version, 2)
    self.assertEqual(len(self.store.list_revisions("user-a", project.id, node.id)), 1)

def test_layout_update_does_not_create_semantic_revision(self) -> None:
    self.service.save_layout("user-a", self.project.id, {self.node.id: (120.0, 80.0)})
    self.assertEqual(self.store.list_revisions("user-a", self.project.id, self.node.id), ())
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_service -v`  
Expected: import failure for `app.projects.service`.

- [ ] **Step 3: Implement `ProjectService`**

Implement these exact public operations: `create_project(user_id, title)`, `list_projects(user_id)`, `get_graph(user_id, project_id)`, `create_node(user_id, project_id, node_type, title, content, created_by, expected_project_version)`, `update_node(user_id, project_id, node_id, title, content, expected_node_version)`, `connect_nodes(user_id, project_id, source_id, target_id, edge_type, expected_project_version)`, `trash_node(user_id, project_id, node_id, expected_node_version)`, `restore_node(user_id, project_id, node_id, expected_node_version)`, `save_layout(user_id, project_id, positions)`, `save_annotations(user_id, project_id, annotations, expected_annotation_version)`, `store_media(user_id, project_id, filename, declared_mime, content)`, `read_media(user_id, project_id, media_id)`, `delete_media(user_id, project_id, media_id)`, `set_user_theme(user_id, theme)`, and `set_project_theme(user_id, project_id, theme_or_none)`. Detect media type from magic bytes, replace the client filename with an opaque UUID key, cap streamed input at 5 MiB, and delete unreferenced media explicitly rather than relying on semantic-node deletion.

Use the following compare-and-swap pattern for semantic updates:

```python
def update_node(self, user_id: str, project_id: str, node_id: str,
                title: str, content: str, expected_node_version: int) -> GraphNode:
    current = self._store.get_node(user_id, project_id, node_id)
    if current is None:
        raise GraphItemNotFound(node_id)
    if current.version != expected_node_version:
        raise VersionConflict(node_id)
    candidate = replace(
        current,
        title=_required(title, "title"),
        content=_required(content, "content"),
        version=current.version + 1,
        updated_at=_utc_now(),
    )
    self._store.append_revision(user_id, NodeRevision.from_node(current))
    self._store.update_node(user_id, candidate, expected_node_version)
    return candidate
```

Use copy-on-write candidates and persist only after every invariant passes. Edges may connect only live nodes in the same owned project. Semantic updates append the prior node as a revision before incrementing its version.

- [ ] **Step 4: Run focused and existing backend tests**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_service tests.test_project_store tests.test_hermes -v`  
Expected: all selected tests pass; guarded integrations remain skipped only when their variables are absent.

- [ ] **Step 5: Commit the service**

```bash
git add backend/app/projects/service.py backend/tests/test_project_service.py
git commit -m "feat(projects): enforce versioned graph mutations"
```

### Task 4: Expose the authenticated project and graph API

**Files:**
- Create: `backend/app/api/projects.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/composition.py`
- Test: `backend/tests/test_projects_api.py`
- Test: `backend/tests/test_composition.py`

- [ ] **Step 1: Write failing API contract tests**

Test missing and invalid auth, owner isolation, exact `201` project/node responses, safe `404`, stale `409` with `{ "code": "version_conflict" }`, validation that never echoes submitted content, separate layout/annotation saves, annotation isolation from semantic versions, global/project theme preference precedence, and media upload/download. Media tests accept only PNG/JPEG/WebP, reject MIME spoofing and payloads over 5 MiB before persistence, return safe `413`/`415` errors, forbid cross-owner reads, and clean orphaned uploads when annotation attachment fails.

```python
def test_other_owner_cannot_read_project(self) -> None:
    created = self.client.post(
        "/projects", json={"title": "Secret brand"}, headers=self.auth("valid-a")
    ).json()
    response = self.client.get(f"/projects/{created['id']}", headers=self.auth("valid-b"))
    self.assertEqual(response.status_code, 404)
    self.assertEqual(response.json(), {"detail": "Project not found."})
```

- [ ] **Step 2: Run the API tests and confirm RED**

Run: `cd backend && .venv/bin/python -m unittest tests.test_projects_api -v`  
Expected: project routes return `404` because the router is not registered.

- [ ] **Step 3: Add Pydantic request/response models and routes**

Implement authenticated endpoints:

```text
POST   /projects
GET    /projects
GET    /projects/{project_id}
POST   /projects/{project_id}/nodes
PATCH  /projects/{project_id}/nodes/{node_id}
POST   /projects/{project_id}/edges
POST   /projects/{project_id}/nodes/{node_id}/trash
POST   /projects/{project_id}/nodes/{node_id}/restore
PUT    /projects/{project_id}/layout
PUT    /projects/{project_id}/annotations
POST   /projects/{project_id}/media
GET    /projects/{project_id}/media/{media_id}
DELETE /projects/{project_id}/media/{media_id}
PUT    /projects/{project_id}/theme
PUT    /users/me/theme
GET    /projects/{project_id}/revisions/{node_id}
```

Use strict bounded strings and finite coordinate validation. Map typed domain errors to exact safe `404`, `409`, and `503` responses.

- [ ] **Step 4: Compose the project service in memory and register the router**

Add `project_store` and `project_service` to `ApplicationComposition`. In memory mode use `InMemoryProjectStore`. Register `projects.router` at `/projects`. Update deterministic composition tests to prove a single project service is reused and closed resources remain unchanged.

- [ ] **Step 5: Run API, composition, and full backend tests**

Run: `cd backend && .venv/bin/python -m unittest tests.test_projects_api tests.test_composition -v`  
Then: `cd backend && .venv/bin/python -m unittest discover -s tests -v`  
Expected: all tests pass, with only documented local-Supabase skips.

- [ ] **Step 6: Commit the API slice**

```bash
git add backend/app/api/projects.py backend/app/main.py backend/app/composition.py backend/tests/test_projects_api.py backend/tests/test_composition.py
git commit -m "feat(api): expose versioned brand projects"
```

### Task 5: Add local Supabase graph persistence and rollback

**Files:**
- Create: `supabase/migrations/20260726090000_add_spatial_brand_projects.sql`
- Create: `supabase/manual/rollback_spatial_brand_projects.sql`
- Create: `backend/app/projects/supabase_store.py`
- Test: `backend/tests/test_supabase_projects.py`
- Modify: `backend/app/composition.py`
- Modify: `backend/tests/test_composition.py`

- [ ] **Step 1: Write failing SQL-contract and store tests**

Assert that every project-scoped table has `user_id`, RLS is enabled, service-role-only atomic RPCs revoke public execution, semantic/layout/annotation data are separate, annotation writes cannot update semantic versions, theme preferences are owner scoped, and every Supabase query includes both owner and project identifiers. Guard live integration with `SUPABASE_LOCAL_TEST_URL`, `SUPABASE_LOCAL_TEST_KEY`, `SUPABASE_LOCAL_SERVICE_ROLE_KEY`, and loopback hostname proof.

- [ ] **Step 2: Run tests and confirm RED**

Run: `cd backend && .venv/bin/python -m unittest tests.test_supabase_projects -v`  
Expected: missing migration/store assertions fail; live integration skips only when explicit local variables are absent.

- [ ] **Step 3: Create the local migration**

Create owner-scoped tables for `brand_projects`, `brand_nodes`, `brand_edges`, `brand_node_revisions`, `brand_layouts`, `brand_media`, `brand_annotations`, `brand_user_preferences`, `brand_proposals`, `brand_analysis_cache`, and `brand_blueprint_snapshots`. Add a private local `brand-canvas-media` Storage bucket with 5 MiB file limit and PNG/JPEG/WebP allowlist. Add foreign keys that include project ownership, unique semantic-edge constraints, positive versions, annotation/media-reference checks, Paper/Graphite/Project theme checks, timestamps, and indexes for owner/project/state queries. Store only opaque object keys in metadata and serve bytes through the authorized backend route rather than public bucket URLs.

Create `accept_brand_proposal(p_user_id uuid, p_project_id uuid, p_proposal_id uuid, p_expected_project_version bigint)` and explicit compare-and-swap node/project RPCs using transaction-scoped advisory locks. Revoke execution from `public`, `anon`, and `authenticated`; grant only `service_role`. Do not add permissive credential-style policies.

- [ ] **Step 4: Implement `SupabaseProjectStore`**

Match the `ProjectStore` protocol. Scope every operation by `user_id` and `project_id`, sanitize SDK exceptions into `StoreFailure`, validate returned row identity and version, and use atomic RPCs for proposal acceptance and compare-and-swap mutations.

- [ ] **Step 5: Add manual rollback**

Drop RPCs first, delete the private local media bucket and objects, then drop snapshots, cache, proposals, preferences, annotations, media metadata, revisions, layouts, edges, nodes, and projects. Keep the rollback outside migration history and document that `supabase db reset --local` reapplies the migration.

- [ ] **Step 6: Wire persistent composition and run guarded tests**

Run offline store tests first. If explicit local Supabase variables are available, run only against the proven loopback stack:

```bash
cd backend
SUPABASE_LOCAL_TEST_URL="$API_URL" \
SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" \
SUPABASE_LOCAL_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
.venv/bin/python -m unittest tests.test_supabase_projects -v
```

Expected: disposable rows are created and cleaned locally; no provider is called.

- [ ] **Step 7: Commit persistence**

```bash
git add supabase/migrations/20260726090000_add_spatial_brand_projects.sql supabase/manual/rollback_spatial_brand_projects.sql backend/app/projects/supabase_store.py backend/app/composition.py backend/tests/test_supabase_projects.py backend/tests/test_composition.py
git commit -m "feat(projects): persist brand graphs locally"
```

### Task 6: Define Hermes graph-analysis schemas and relevant-subgraph selection

**Files:**
- Modify: `backend/app/llm/schemas.py`
- Create: `backend/app/projects/analysis.py`
- Test: `backend/tests/test_project_analysis.py`
- Modify: `backend/app/composition.py`

- [ ] **Step 1: Write failing schema and context-selection tests**

Test strict rejection of extra fields and coercion, maximum proposal counts, known node/edge types, no mutation on invalid output, bounded breadth/depth, deterministic ordering, and exclusion of unrelated branches.

```python
def test_context_contains_selected_neighborhood_not_entire_graph(self) -> None:
    context = select_analysis_context(self.graph, selected_node_id="audience", max_nodes=24)
    self.assertIn("positioning", context.node_ids)
    self.assertNotIn("unrelated-logo-branch", context.node_ids)
    self.assertLessEqual(len(context.node_ids), 24)
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_analysis -v`  
Expected: missing analysis symbols.

- [ ] **Step 3: Add strict Pydantic outputs**

Add frozen strict models:

```python
class ProposedNodeOutput(StrictOutput):
    client_key: ShortText
    node_type: Literal["evidence", "assumption", "idea", "decision", "challenge"]
    title: ShortText
    content: NonEmptyStr
    rationale: NonEmptyStr

class ProposedEdgeOutput(StrictOutput):
    source_key: ShortText
    target_key: ShortText
    edge_type: Literal["supports", "contradicts", "depends_on", "inspires", "supersedes"]

class GraphAnalysisOutput(StrictOutput):
    summary: NonEmptyStr
    proposed_nodes: Annotated[tuple[ProposedNodeOutput, ...], Field(max_length=8)]
    proposed_edges: Annotated[tuple[ProposedEdgeOutput, ...], Field(max_length=12)]
    affected_node_ids: Annotated[tuple[ShortText, ...], Field(max_length=24)]
```

- [ ] **Step 4: Implement deterministic context and fingerprint functions**

Implement `select_analysis_context`, `summarize_branch`, and `analysis_fingerprint`. Hash canonical JSON containing dependency IDs/versions, analysis type, provider/model, prompt version, and schema version. Never include layout positions in the fingerprint.

- [ ] **Step 5: Add deterministic test-router support**

Extend `DeterministicStructuredRouter` so test mode returns a valid `GraphAnalysisOutput` without network access. Add a composition test proving the new analysis service uses the same routed settings readiness as legacy Hermes.

- [ ] **Step 6: Run analysis and router tests**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_analysis tests.test_llm_router tests.test_composition -v`  
Expected: all pass.

- [ ] **Step 7: Commit analysis contracts**

```bash
git add backend/app/llm/schemas.py backend/app/projects/analysis.py backend/app/composition.py backend/tests/test_project_analysis.py backend/tests/test_composition.py
git commit -m "feat(hermes): define graph analysis contracts"
```

### Task 7: Implement cached proposals, challenges, and atomic acceptance

**Files:**
- Modify: `backend/app/projects/analysis.py`
- Modify: `backend/app/projects/service.py`
- Modify: `backend/app/api/projects.py`
- Test: `backend/tests/test_project_analysis.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write failing cache and proposal lifecycle tests**

Test exact cache reuse with zero router calls, dependency-specific invalidation, proposal preview without graph mutation, stale acceptance conflicts, idempotent acceptance, challenge resolution/deferral/override, and safe provider errors.

```python
def test_unchanged_analysis_uses_cache_without_second_provider_call(self) -> None:
    first = self.analysis.analyze("user-a", self.project.id, self.node.id, "challenge")
    second = self.analysis.analyze("user-a", self.project.id, self.node.id, "challenge")
    self.assertEqual(first.id, second.id)
    self.assertEqual(self.router.calls, 1)
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_analysis tests.test_projects_api -v`  
Expected: missing analyze/accept/resolve behavior.

- [ ] **Step 3: Implement `GraphAnalysisService`**

Resolve context, compute fingerprint, return valid cached proposals, otherwise call `StructuredLlmRouter.generate(user_id, GraphAnalysisOutput, system_prompt, user_json)`, persist dependency versions and a pending proposal, and return a safe proposal DTO. Do not write nodes or edges during analysis.

- [ ] **Step 4: Implement atomic proposal acceptance and challenge resolution**

Translate client keys to generated node IDs, validate every proposed reference and type, apply the complete candidate graph under the expected project version, and mark the proposal accepted in the same atomic store operation. Repeated acceptance returns the accepted result. Add explicit challenge resolution records for resolved, deferred, and intentionally overridden states.

- [ ] **Step 5: Expose endpoints**

```text
POST /projects/{project_id}/analysis
GET  /projects/{project_id}/proposals
POST /projects/{project_id}/proposals/{proposal_id}/accept
POST /projects/{project_id}/challenges/{node_id}/resolve
```

Return `409 ai_configuration_required`, safe `503 all_providers_failed`, `409 version_conflict`, and owner-safe `404` using existing error shapes.

- [ ] **Step 6: Run focused and full backend suites**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_analysis tests.test_projects_api -v`  
Then: `cd backend && .venv/bin/python -m unittest discover -s tests -v`  
Expected: all pass with only guarded local skips.

- [ ] **Step 7: Commit Hermes proposals**

```bash
git add backend/app/projects/analysis.py backend/app/projects/service.py backend/app/api/projects.py backend/tests/test_project_analysis.py backend/tests/test_projects_api.py
git commit -m "feat(hermes): cache and review graph proposals"
```

### Task 8: Compile immutable Starter Brand Blueprints

**Files:**
- Create: `backend/app/projects/blueprint.py`
- Modify: `backend/app/api/projects.py`
- Test: `backend/tests/test_project_blueprint.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write failing readiness and snapshot tests**

Test section readiness, explicit unresolved assumptions, deterministic ordering, same-version idempotency, immutable historical snapshots, early generation warnings, and owner isolation.

```python
def test_blueprint_exposes_unresolved_assumptions_and_source_nodes(self) -> None:
    snapshot = self.compiler.compile("user-a", self.project.id, expected_project_version=7)
    audience = snapshot.sections["audience"]
    self.assertEqual(audience.source_node_ids, ("audience-decision", "audience-evidence"))
    self.assertEqual(snapshot.unresolved_assumption_ids, ("audience-assumption",))
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_blueprint -v`  
Expected: missing Blueprint compiler.

- [ ] **Step 3: Implement deterministic readiness and compilation**

Define required sections: purpose, audience, positioning, promise, personality/voice, naming, messaging, visual direction, evidence/assumptions, unresolved challenges, and next actions. A section is ready only when it has at least one live approved decision and no unresolved blocking challenge. Generate warnings instead of blocking early snapshots.

- [ ] **Step 4: Add snapshot endpoints**

```text
GET  /projects/{project_id}/blueprint/readiness
POST /projects/{project_id}/blueprints
GET  /projects/{project_id}/blueprints
GET  /projects/{project_id}/blueprints/{snapshot_id}
```

Persist canonical JSON, project version, sequence number, and UTC timestamp. Never mutate an existing snapshot.

- [ ] **Step 5: Run Blueprint and API tests**

Run: `cd backend && .venv/bin/python -m unittest tests.test_project_blueprint tests.test_projects_api -v`  
Expected: all pass.

- [ ] **Step 6: Commit Blueprint backend**

```bash
git add backend/app/projects/blueprint.py backend/app/api/projects.py backend/tests/test_project_blueprint.py backend/tests/test_projects_api.py
git commit -m "feat(projects): compile versioned brand blueprints"
```

### Task 9: Add client test infrastructure and graph dependencies

**Files:**
- Modify: `client/package.json`
- Modify: `client/package-lock.json`
- Create: `client/vitest.config.ts`
- Create: `client/test/setup.ts`
- Create: `client/components.json`
- Create: `client/app/lib/utils.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `backend/tests/test_ci_workflow.py`

- [ ] **Step 1: Extend the CI contract test first**

Require `npm run test:unit` in the client-quality job and preserve all existing gates. Run: `cd backend && .venv/bin/python -m unittest tests.test_ci_workflow -v`.  
Expected: FAIL because CI does not run the new unit suite.

- [ ] **Step 2: Install pinned dependencies**

Run from `client/`:

```bash
npm install @xyflow/react motion clsx tailwind-merge lucide-react perfect-freehand
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Do not add a runtime 21st.dev dependency. Components are reviewed and copied locally later.

- [ ] **Step 3: Configure Vitest and shadcn-compatible aliases**

Configure jsdom, `@/*`, setup imports, and a `test:unit` script. Set `components.json` aliases to `@/app/components`, `@/app/components/ui`, `@/app/lib/utils`, and `@/app/styles`. Implement:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Update CI and make the contract GREEN**

Add `npm run test:unit` before build in `client-quality`. Run backend CI-contract test and `cd client && npm run test:unit -- --run`.

- [ ] **Step 5: Run mandatory client quality gates**

Run: `cd client && npm run lint && npx tsc --noEmit && npm run test:unit -- --run && npm run build`  
Expected: all commands exit zero.

- [ ] **Step 6: Commit tooling**

```bash
git add client/package.json client/package-lock.json client/vitest.config.ts client/test/setup.ts client/components.json client/app/lib/utils.ts .github/workflows/ci.yml backend/tests/test_ci_workflow.py
git commit -m "build(client): add graph and unit test foundations"
```

### Task 10: Build typed project API and pure graph state

**Files:**
- Create: `client/app/lib/project-types.ts`
- Create: `client/app/lib/projects-api.ts`
- Create: `client/app/lib/project-graph.ts`
- Create: `client/app/lib/project-graph.test.ts`
- Create: `client/app/lib/project-annotations.ts`
- Create: `client/app/lib/project-annotations.test.ts`
- Create: `client/app/lib/project-theme.ts`
- Create: `client/app/lib/project-theme.test.ts`
- Test: `client/e2e/projects.spec.ts`

- [ ] **Step 1: Write failing reducer and API tests**

Test immutable quick capture, proposal preview without base mutation, accept/reject preview, semantic undo/redo, annotation undo/redo, proof that annotation actions cannot mutate semantic records, semantic-vs-layout updates, Paper/Graphite/Project selection, safe project-palette derivation, safe error mapping, and one-401 retry through the auth client.

```typescript
it("previews a proposal without mutating the accepted graph", () => {
  const preview = previewProposal(graph, proposal);
  expect(preview.nodes).toHaveLength(graph.nodes.length + 1);
  expect(graph.nodes).toHaveLength(1);
  expect(preview.nodes.at(-1)?.preview).toBe(true);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `cd client && npm run test:unit -- --run app/lib/project-graph.test.ts`  
Expected: missing module exports.

- [ ] **Step 3: Define exact client types and API client**

Mirror backend enums as string unions. Implement list/create/load graph, node/edge/layout/annotation mutations, bounded media upload/delete and authorized media URL resolution, analyze, list/accept proposals, resolve challenge, readiness, snapshot, global-theme, and project-theme methods. Reuse `api-client.ts` authentication behavior and typed safe error messages; never include raw graph content in rendered server errors.

- [ ] **Step 4: Implement pure graph state functions**

Use readonly inputs and return new arrays/maps. Keep semantic content, annotations, UI selection, viewport, layout positions, proposal preview, and undo histories in separate slices. `reduceAnnotationAction` accepts only annotation state and cannot return or receive semantic nodes or edges. `deriveProjectTheme` returns Paper tokens until an approved accessible visual-palette decision exists; Graphite uses fixed neutral dark tokens; Project adjusts unsafe interface accents without rewriting the approved brand values.

- [ ] **Step 5: Run unit tests and type check**

Run: `cd client && npm run test:unit -- --run app/lib/project-graph.test.ts && npx tsc --noEmit`  
Expected: all pass.

- [ ] **Step 6: Commit client domain**

```bash
git add client/app/lib/project-types.ts client/app/lib/projects-api.ts client/app/lib/project-graph.ts client/app/lib/project-graph.test.ts client/app/lib/project-annotations.ts client/app/lib/project-annotations.test.ts client/app/lib/project-theme.ts client/app/lib/project-theme.test.ts
git commit -m "feat(client): add typed project graph state"
```

### Task 11: Add the Projects page and adaptive diagnostic

**Files:**
- Create: `client/app/(protected)/projects/page.tsx`
- Create: `client/app/(protected)/projects/new/page.tsx`
- Create: `client/app/components/projects/project-list.tsx`
- Create: `client/app/components/projects/project-diagnostic.tsx`
- Modify: `client/app/(protected)/layout.tsx`
- Modify: `client/app/(protected)/page.tsx`
- Test: `client/e2e/projects.spec.ts`

- [ ] **Step 1: Write failing Playwright tests**

Cover protected routing, empty state, project creation, diagnostic draft preservation, seeding facts/assumptions/goals/open questions, explicit user-supplied provenance, same-account recovery, and another-owner isolation.

- [ ] **Step 2: Run the focused E2E spec and confirm RED**

Run: `cd client && BACKEND_PYTHON=../backend/.venv/bin/python npx playwright test e2e/projects.spec.ts`  
Expected: `/projects` or `/projects/new` returns 404.

- [ ] **Step 3: Implement the project home**

Use the compact, neutral `ui-updates` workbench language rather than promotional cards: strong typography, warm neutral surfaces, thin borders, restrained elevation, and content-first spacing. Each row shows title, updated time, Blueprint readiness, unresolved challenge count, and one Open action. Provide a clear empty state and Create project action.

- [ ] **Step 4: Implement the adaptive diagnostic**

Collect intent, known facts, assumptions, constraints, desired outcomes, and open questions. Allow skip/save/return without inventing missing answers. Submission creates the project first, then seeds typed nodes through authenticated API calls. If seeding partially fails, retain the unsent diagnostic draft and link to the created project for recovery.

- [ ] **Step 5: Redirect the protected root to Projects without deleting legacy UI**

Keep legacy routes available for the rollout task. Update navigation to Projects, current project, Settings, and sign out.

- [ ] **Step 6: Run E2E, lint, and type checks**

Run focused E2E, then `cd client && npm run lint && npx tsc --noEmit`.  
Expected: all pass.

- [ ] **Step 7: Commit project entry flow**

```bash
git add 'client/app/(protected)/projects' client/app/components/projects 'client/app/(protected)/layout.tsx' 'client/app/(protected)/page.tsx' client/e2e/projects.spec.ts
git commit -m "feat(client): add adaptive brand projects"
```

### Task 12: Build the React Flow constellation core

**Files:**
- Create: `client/app/(protected)/projects/[projectId]/page.tsx`
- Create: `client/app/components/constellation/constellation-editor.tsx`
- Create: `client/app/components/constellation/project-map-panel.tsx`
- Create: `client/app/components/constellation/nodes/brand-node.tsx`
- Create: `client/app/components/constellation/edges/semantic-edge.tsx`
- Create: `client/app/components/constellation/annotation-layer.tsx`
- Create: `client/app/components/constellation/canvas-toolbar.tsx`
- Create: `client/app/components/constellation/constellation-editor.test.tsx`
- Test: `client/e2e/constellation.spec.ts`

- [ ] **Step 1: Write failing unit tests for custom nodes and edges**

Assert visible type/state text, selected and preview semantics, labeled connection handles, no raw HTML injection, relationship labels/patterns, resizer affordances, and memoized node/edge definitions outside render scope. Test that annotations render in a viewport-synchronized sibling SVG layer, annotation events dispatch only annotation actions, and imported media uses validated object URLs or persisted references rather than data URLs in semantic nodes.

- [ ] **Step 2: Write failing desktop E2E tests**

Cover design-tool viewport controls, keyboard focus, pan/zoom, multiselection, node creation, semantic connection, node resizing, select/connect/draw/erase modes, separate semantic/layout/annotation saves, independent undo/redo, viewport restoration, filters, minimap, and graph reload.

- [ ] **Step 3: Run tests and confirm RED**

Run unit test and focused Playwright spec. Expected: route/components missing.

- [ ] **Step 4: Implement the editor with React Flow**

Use controlled nodes/edges and custom renderers inspired by the `ui-updates` note, image, root, and sticky-note interactions. Configure `panOnScroll`, `selectionOnDrag`, mode-dependent `panOnDrag`, `selectionMode="partial"`, `nodesFocusable`, `edgesFocusable`, `autoPanOnNodeFocus`, and localized `ariaLabelConfig`. Keep viewport/layout state out of semantic graph state and never place editable form controls inside draggable node bodies.

- [ ] **Step 5: Implement isolated annotations and canvas toolbar**

Use `perfect-freehand` to convert pointer samples into SVG paths and `screenToFlowPosition` plus the React Flow viewport transform to keep marks aligned while pan/zoom changes. The toolbar exposes Select, Connect, Draw, Erase, Add thought, and Add media with text labels or accessible names, visible selected state, keyboard shortcuts, and touch equivalents. Add media uploads through the bounded project-media endpoint, stores only returned `media_id` values in annotations, revokes preview object URLs after success/failure, and removes an uploaded object if annotation persistence fails. Persist annotations through the annotation endpoint with their own version; never include annotation content or media bytes in Hermes context, readiness, graph revisions, or Blueprint compilation.

- [ ] **Step 6: Implement map panel and autosave**

Provide clusters, branches, type filters, unresolved-only filter, minimap, fit selection, and explicit save status. Batch layout updates after pointer/keyboard movement without triggering Hermes analysis.

- [ ] **Step 7: Run focused and quality gates**

Run unit tests, focused E2E, lint, and type check. Expected: all pass.

- [ ] **Step 8: Commit canvas core**

```bash
git add 'client/app/(protected)/projects/[projectId]/page.tsx' client/app/components/constellation client/e2e/constellation.spec.ts
git commit -m "feat(client): add spatial brand constellation"
```

### Task 13: Add quick capture, inspector, proposals, and challenges

**Files:**
- Create: `client/app/components/constellation/node-inspector.tsx`
- Create: `client/app/components/constellation/command-surface.tsx`
- Create: `client/app/components/constellation/proposal-tray.tsx`
- Create: `client/app/components/constellation/challenge-panel.tsx`
- Modify: `client/app/components/constellation/constellation-editor.tsx`
- Create: `client/app/components/constellation/constellation-actions.test.tsx`
- Modify: `client/e2e/constellation.spec.ts`

- [ ] **Step 1: Write failing interaction tests**

Test quick capture without provider calls, precise node editing, guided analysis busy state without locking canvas, proposal preview, accept/reject, active challenge reasoning, resolve/defer/override, stale conflicts, missing AI configuration recovery, and provider retry with draft preservation.

- [ ] **Step 2: Run tests and confirm RED**

Run focused unit and E2E tests. Expected: missing controls and proposal behavior.

- [ ] **Step 3: Implement quick capture and inspector**

Quick capture creates a typed node locally, persists it, and restores the draft on failure. The inspector edits content, type/state, semantic connections, source/provenance, and revision history without embedding form controls inside draggable node bodies.

- [ ] **Step 4: Implement guided analysis and proposal review**

Start analysis from the selected node, keep the canvas operable, show exact relevant scope, preview proposed nodes/edges with non-approved semantics, and accept only under the loaded project version. Open Settings for `ai_configuration_required` and preserve the request for retry.

- [ ] **Step 5: Implement challenge decisions**

Render rationale, dependencies, confidence, and downstream effect. Require a note for intentional override. Announce resolution state and keep the challenge linked in history.

- [ ] **Step 6: Verify focused and full client unit suites**

Run unit tests, focused E2E, lint, and type check. Expected: all pass.

- [ ] **Step 7: Commit Hermes interactions**

```bash
git add client/app/components/constellation client/e2e/constellation.spec.ts
git commit -m "feat(client): review Hermes graph challenges"
```

### Task 14: Implement the versatile workbench themes and Motion behavior

**Files:**
- Modify: `DESIGN.md`
- Modify: `client/app/styles/tokens.css`
- Modify: `client/app/globals.css`
- Create: `client/app/styles/workbench.css`
- Create: `client/app/styles/constellation.css`
- Create: `client/app/components/ui/workbench-panel.tsx`
- Create: `client/app/components/ui/editor-toolbar.tsx`
- Create: `client/app/components/ui/theme-selector.tsx`
- Create: `client/app/components/ui/component-provenance.test.ts`
- Create: `client/app/components/ui/theme-contract.test.tsx`
- Create: `docs/COMPONENT_PROVENANCE.md`
- Modify: constellation and project components from Tasks 11–13

- [ ] **Step 1: Write failing design-contract tests**

Scan source for required Paper/Graphite/Project tokens, reduced-motion selectors, standardized status tokens, no legacy glass/bloom/skew-gradient declarations, no unreviewed remote component imports, no `dangerouslySetInnerHTML`, and a provenance entry for each copied component. Render the same project fixture under all three themes and assert that structure, accessible names, status text, and keyboard order do not change.

- [ ] **Step 2: Audit the `ui-updates` reference and any external components**

Record `origin/ui-updates` commit `774011b` as an internal reference and inventory the shell, panel, toolbar, node, resizer, chat-panel, and freehand patterns being adapted. Explicitly reject its monolithic local state, hard-coded colors, base64 image storage, canvas-reset remount, unlabeled icon-only controls, and undeclared dependencies. For each 21st.dev candidate, record source URL, author, license, copied files, dependencies, modifications, and rejection/acceptance decision before adding code; a candidate is optional rather than a delivery requirement.

- [ ] **Step 3: Implement design tokens and primitives**

Define semantic variables for canvas, panel, elevated panel, text, muted text, border, hover, selection, focus, handles, edge types, warnings, errors, success, and Hermes challenges. Paper uses warm-white surfaces and charcoal text; Graphite uses opaque dark neutrals; Project keeps neutral chrome and derives bounded accents from an approved accessible palette, falling back to Paper when none exists. `WorkbenchPanel` exposes semantic element choice, and theme changes must never alter geometry, DOM order, status language, or contrast below AA.

- [ ] **Step 4: Add purposeful Motion transitions**

Use `MotionConfig` and `useReducedMotion`. Animate panel presence, proposal previews, focus transitions, node creation/removal, and Blueprint mode changes. React Flow remains responsible for node dragging/resizing and direct pointer handling remains responsible for drawing. Do not add decorative loops, simulated glass depth, layout-shifting hover, or theme-transition flashes.

- [ ] **Step 5: Implement global defaults and project overrides**

Persist Paper, Graphite, or Project as the authenticated user's default and allow a nullable per-project override. Resolve effective theme as project override, then user default, then Paper. Project derives presentation-only accents from approved palette decisions while keeping platform/status colors fixed; adjusted interface colors never mutate the underlying brand decision.

- [ ] **Step 6: Run source contract, unit, E2E, lint, type, and build checks**

Expected: all pass; capture desktop and mobile screenshots for PR evidence.

- [ ] **Step 7: Commit the visual system**

```bash
git add DESIGN.md docs/COMPONENT_PROVENANCE.md client/app/styles client/app/globals.css client/app/components/ui client/app/components/projects client/app/components/constellation
git commit -m "feat(design): add versatile workbench themes"
```

### Task 15: Add interactive Blueprint and print/PDF snapshots

**Files:**
- Create: `client/app/(protected)/projects/[projectId]/blueprint/page.tsx`
- Create: `client/app/components/blueprint/brand-blueprint.tsx`
- Create: `client/app/components/blueprint/blueprint-section.tsx`
- Create: `client/app/styles/print.css`
- Create: `client/app/components/blueprint/brand-blueprint.test.tsx`
- Create: `client/e2e/blueprint.spec.ts`

- [ ] **Step 1: Write failing Blueprint tests**

Cover every MVP section, source-node links, expandable rationale, evidence/assumption distinction, unresolved challenge warnings, early snapshot warnings, sequence/date/version labels, historical snapshot immutability, print layout, and no editor chrome in print.

- [ ] **Step 2: Run tests and confirm RED**

Run focused unit and E2E specs. Expected: route/components missing.

- [ ] **Step 3: Implement the interactive Blueprint**

Render the canonical server snapshot, not a client reconstruction. Each section links back to graph nodes and reveals rationale without requiring hover. Provide snapshot history and a clear stale-current-graph notice when viewing an older snapshot.

- [ ] **Step 4: Implement print/PDF behavior**

Use the same semantic HTML with `@media print`: remove navigation/editor chrome, avoid translucent backgrounds, preserve high-contrast project accents, add project title/version/date/page-break rules, and invoke the browser print dialog from an explicit Export PDF action.

- [ ] **Step 5: Run Blueprint tests and build**

Run unit test, focused Playwright, lint, type check, and production build. Expected: all pass.

- [ ] **Step 6: Commit Blueprint client**

```bash
git add 'client/app/(protected)/projects/[projectId]/blueprint' client/app/components/blueprint client/app/styles/print.css client/e2e/blueprint.spec.ts
git commit -m "feat(client): publish starter brand blueprints"
```

### Task 16: Add mobile focus mode and accessible graph equivalent

**Files:**
- Create: `client/app/components/constellation/accessible-graph.tsx`
- Create: `client/app/components/constellation/mobile-graph-navigator.tsx`
- Modify: `client/app/components/constellation/constellation-editor.tsx`
- Create: `client/e2e/constellation-mobile.spec.ts`
- Modify: `client/e2e/constellation.spec.ts`

- [ ] **Step 1: Write failing accessibility and mobile tests**

Test tree/list traversal, labeled relationship actions, keyboard creation/connection/move, focus restoration, live announcements, no color-only state, reduced motion, 44px targets, mobile overview/focus/next/previous, automatic layout, complete challenge flow, and no horizontal overflow.

- [ ] **Step 2: Run tests and confirm RED**

Run focused desktop/mobile Playwright specs. Expected: accessible and mobile controls missing.

- [ ] **Step 3: Implement the equivalent structured graph**

Use semantic headings, tree/list roles only where correct, buttons for node/edge actions, explicit type/state/relationship text, and shared mutation functions with the visual canvas. The list is a first-class alternative, not a static summary.

- [ ] **Step 4: Implement mobile focus mode**

Show overview, focused node, neighboring relationships, Next/Previous traversal, automatic layout, quick capture, guided analysis, inspector, proposal tray, and Blueprint access. Precision freeform arrangement is hidden on mobile.

- [ ] **Step 5: Verify accessibility and responsive evidence**

Run focused specs at desktop and mobile sizes, reduced-motion project, lint, type check, and build. Capture evidence at 1440px and 390px widths.

- [ ] **Step 6: Commit accessible/mobile graph**

```bash
git add client/app/components/constellation client/e2e/constellation.spec.ts client/e2e/constellation-mobile.spec.ts
git commit -m "feat(client): make constellation accessible on mobile"
```

### Task 17: Add pending-edit recovery, conflict UI, and performance budgets

**Files:**
- Create: `client/app/lib/pending-project-edits.ts`
- Create: `client/app/lib/pending-project-edits.test.ts`
- Create: `client/app/components/constellation/conflict-panel.tsx`
- Modify: `client/app/components/constellation/constellation-editor.tsx`
- Modify: `client/e2e/constellation.spec.ts`
- Create: `client/e2e/constellation-performance.spec.ts`

- [ ] **Step 1: Write failing recovery and performance tests**

Test bounded owner/project-scoped pending edits, reconnect replay, clear-on-success, page-close warning, compare/keep-mine/accept-latest conflicts, provider failures preserving viewport/draft, 250 visible nodes and 400 edges, collapsed distant clusters, simplified distant nodes, and a mixed annotation fixture that remains aligned through pan/zoom.

- [ ] **Step 2: Run tests and confirm RED**

Run focused unit and E2E specs. Expected: recovery/conflict/performance behavior missing.

- [ ] **Step 3: Implement the bounded pending-edit queue**

Use IndexedDB or a small local-storage adapter with schema version, authenticated owner ID, project ID, idempotency key, expected version, operation type, and bounded payload. Never store provider keys or Hermes raw provider payloads. Replay in order and stop on conflict.

- [ ] **Step 4: Implement conflict comparison**

Show submitted and latest semantic values with exact versions. `Keep mine` retries against latest only after explicit confirmation; `Accept latest` replaces local draft; `Compare` makes no mutation.

- [ ] **Step 5: Optimize and verify the large fixture**

Memoize custom renderers, select narrow React Flow store slices, collapse hidden clusters, simplify distant styles, and ensure layout updates do not trigger semantic re-renders. Do not invent an FPS claim; record test hardware/browser and measured render/interaction timings in the PR.

- [ ] **Step 6: Run recovery, performance, and full client tests**

Expected: all pass with no uncaught browser errors.

- [ ] **Step 7: Commit resilience**

```bash
git add client/app/lib/pending-project-edits.ts client/app/lib/pending-project-edits.test.ts client/app/components/constellation client/e2e/constellation.spec.ts client/e2e/constellation-performance.spec.ts
git commit -m "feat(client): recover pending graph edits"
```

### Task 18: Preserve legacy sessions and complete the cutover

**Files:**
- Modify: `backend/app/api/creative.py`
- Modify: `backend/app/core/hermes.py`
- Modify: `backend/app/persistence/session_store.py`
- Modify: `backend/tests/test_creative_api.py`
- Modify: `backend/tests/test_hermes.py`
- Modify: `client/app/(protected)/page.tsx`
- Create: `client/app/(protected)/projects/legacy/[sessionId]/page.tsx`
- Create: `client/app/components/projects/legacy-session.tsx`
- Modify: `client/app/studio/page.tsx`
- Modify: `client/e2e/guided-workspace.spec.ts`
- Modify: `client/e2e/projects.spec.ts`

- [ ] **Step 1: Write failing legacy-read-only tests**

Test that legacy sessions remain owner-scoped and readable, cannot be mutated through the new graph API, display a read-only label, preserve prior artifact/direction data, and do not infer graph relationships. Test `/` routes authenticated users to Projects and `/studio` reaches the legacy view or documented redirect.

- [ ] **Step 2: Run tests and confirm RED**

Run focused backend/API and Playwright specs. Expected: legacy project presentation missing.

- [ ] **Step 3: Add safe legacy session retrieval**

Extend `SessionStore` with `list(user_id)` and implement it in memory and Supabase with deterministic `updated_at` ordering and exact owner filtering. Add `Hermes.list_sessions(user_id)` and keep `Hermes.get_session(user_id, session_id)` owner-scoped. Expose `GET /creative/sessions` and `GET /creative/sessions/{session_id}` with the existing serialized session contract plus `legacy: true`. Do not add graph conversion.

- [ ] **Step 4: Add read-only legacy route and final navigation**

Render prior Brand DNA, directions, refinement, and artifact without approve/reject/execute controls. Link legacy sessions from Projects under a separate section. Make Projects the authenticated home.

- [ ] **Step 5: Run legacy and new journey tests**

Expected: both existing session coverage and new Projects coverage pass.

- [ ] **Step 6: Commit cutover**

```bash
git add backend/app/api/creative.py backend/app/core/hermes.py backend/app/persistence/session_store.py backend/tests/test_creative_api.py backend/tests/test_hermes.py 'client/app/(protected)/page.tsx' 'client/app/(protected)/projects/legacy' client/app/components/projects/legacy-session.tsx client/app/studio/page.tsx client/e2e/guided-workspace.spec.ts client/e2e/projects.spec.ts
git commit -m "feat(projects): preserve legacy creative sessions"
```

### Task 19: Synchronize authoritative documentation

**Files:**
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `README.md`
- Modify: `docs/CLIENT_FLOW.md`
- Modify: `docs/API.md`
- Modify: `docs/SUPABASE.md`
- Modify: `docs/DEVLOG.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Write or update documentation-contract tests first**

Extend existing CI/API/migration contract tests to require Projects routes, graph migration/rollback, client unit tests, and new mandatory dependencies where appropriate. Run and confirm RED before documentation or workflow changes.

- [ ] **Step 2: Update product and design contracts**

Replace the fixed campaign-first purpose with the approved spatial brand-development purpose. Document typed graph behavior, isolated annotations, active challenges, Blueprint output, the versatile `ui-updates`-derived workbench, Paper/Graphite/Project precedence, safe project-palette adaptation, accessibility, Motion rules, and deliberate omissions.

- [ ] **Step 3: Update client and API contracts**

Document every route, request/response, version-conflict shape, proposal lifecycle, challenge state, cache behavior, Blueprint snapshot, legacy route, local queue limit, and error recovery path.

- [ ] **Step 4: Update local persistence and rollback documentation**

Document new local tables/RPCs, migration command, rollback order, guarded integration variables, cleanup, and the unchanged prohibition on remote Supabase mutation.

- [ ] **Step 5: Update setup and verification**

Add React Flow, Lucide React, `perfect-freehand`, Motion, Vitest, Chromium, theme, annotation, and print/PDF verification instructions. Keep README concise and link to authoritative details. Add one concise DEVLOG entry; do not recreate `CHANGELOG.md`.

- [ ] **Step 6: Run documentation contract tests and link checks**

Expected: zero stale references to the fixed workflow as the primary product, no broken relative links, and all contract tests pass.

- [ ] **Step 7: Commit documentation**

```bash
git add PRODUCT.md DESIGN.md README.md docs backend/tests/test_ci_workflow.py
git commit -m "docs: describe spatial brand workspace"
```

### Task 20: Run full gates and prepare the pull request

**Files:**
- Modify only if verification reveals a defect; fixes require a new RED → GREEN cycle.
- Read: `.github/pull_request_template.md`

- [ ] **Step 1: Run the complete backend suite on Python 3.11+**

Run: `cd backend && .venv/bin/python -m unittest discover -s tests -v`  
Record total tests, skips, and failures. Missing local Supabase variables may skip guarded integration; configured local tests must pass.

- [ ] **Step 2: Run all client quality gates**

```bash
cd client
npm run lint
npx tsc --noEmit
npm run test:unit -- --run
npm run build
```

Record exact results.

- [ ] **Step 3: Run complete Playwright coverage**

Run: `cd client && npm run test:e2e`.  
Record total tests, failures, and skips. Attach desktop and mobile evidence for landing, Projects, diagnostic, constellation, annotation/media tools, challenge/proposal, Blueprint, settings, reduced motion, and legacy view. Capture the same representative constellation in Paper, Graphite, and Project themes and report any accessibility scan failures per theme.

- [ ] **Step 4: Run guarded local Supabase integration when configured**

Evaluate only trusted `supabase status -o env` output, prove loopback hostname, run project/auth/settings integration, and clean disposable rows/users. Never link or push.

- [ ] **Step 5: Audit security and provenance**

Confirm no secrets, `.env.local`, generated artifacts, traces, test results, or unreviewed component code are tracked. Confirm the `ui-updates` adaptation inventory and every externally derived file appear in `docs/COMPONENT_PROVENANCE.md`; confirm `lucide-react` and `perfect-freehand` are declared in both package manifests and lockfile rather than supplied as extraneous local dependencies.

- [ ] **Step 6: Review the diff against the approved spec**

Check every section of `docs/superpowers/specs/2026-07-26-spatial-brand-workspace-design.md`. Disclose deferred items explicitly rather than silently omitting them.

- [ ] **Step 7: Commit verification-only fixes, then push the feature branch**

Do not merge. Push `codex/spatial-brand-workspace-design` or the implementation branch created from it.

- [ ] **Step 8: Open a pull request targeting `main`**

Use `.github/pull_request_template.md`. Report exact commands, test counts, skips/failures, owned documentation, local-only Supabase evidence, component provenance, desktop/mobile screenshots, performance fixture evidence, deferred work, and safety notes. Mark non-applicable sections explicitly; do not delete them.

---

## Planned commit sequence

1. `feat(projects): define typed brand graph domain`
2. `feat(projects): add owner-scoped graph store`
3. `feat(projects): enforce versioned graph mutations`
4. `feat(api): expose versioned brand projects`
5. `feat(projects): persist brand graphs locally`
6. `feat(hermes): define graph analysis contracts`
7. `feat(hermes): cache and review graph proposals`
8. `feat(projects): compile versioned brand blueprints`
9. `build(client): add graph and unit test foundations`
10. `feat(client): add typed project graph state`
11. `feat(client): add adaptive brand projects`
12. `feat(client): add spatial brand constellation`
13. `feat(client): review Hermes graph challenges`
14. `feat(design): add versatile workbench themes`
15. `feat(client): publish starter brand blueprints`
16. `feat(client): make constellation accessible on mobile`
17. `feat(client): recover pending graph edits`
18. `feat(projects): preserve legacy creative sessions`
19. `docs: describe spatial brand workspace`

## Handoff constraints

- The original design spec commit is `9ffa7a5`; the approved versatile-workbench revision is `7a5b4d2` on `codex/spatial-brand-workspace-design`.
- The branch is based on `fa214a6`, which includes the provider structured-output work. If that commit is merged separately, rebase the redesign branch onto updated `main` before implementation and verify the diff contains the spec/plan only.
- `origin/ui-updates` commit `774011b` is a visual and interaction reference, not a merge base or implementation dependency. Adapt its workbench patterns through the typed architecture; do not cherry-pick its monolithic page or copy its undeclared-dependency state.
- The user explicitly requires implementation on a separate feature branch. Never start implementation on `main`.
