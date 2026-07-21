# Guided Workspace Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disconnected workspace prototype with one Hermes-backed guided creative session from brief through final artifact, using local-only Supabase development and synchronized documentation.

**Architecture:** Focused Brief, DNA, and Outputs views consume one React session provider and typed API client. FastAPI publishes explicit schemas while Hermes alone validates lifecycle transitions. Unit/API tests use an in-memory store; browser tests run the real deterministic FastAPI backend; local Supabase is opt-in and guarded against remote use.

**Tech Stack:** Python 3.11, FastAPI, Pydantic 2, unittest/TestClient, Next.js 16, React 19, TypeScript, Playwright, Supabase CLI/Docker.

---

### Task 1: Enforce the Hermes lifecycle

**Files:**
- Modify: `backend/tests/test_hermes.py`
- Modify: `backend/app/core/hermes.py`

- [ ] **Step 1: Replace legacy tests with failing lifecycle tests**

Write tests using an explicit `InMemorySessionStore`, a helper that starts a session, and structured `Rejection` values:

```python
import unittest

from app.core.hermes import (
    DirectionNotFoundError,
    Hermes,
    InvalidSessionStateError,
)
from app.core.types import Rejection
from app.persistence.session_store import InMemorySessionStore


class HermesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.hermes = Hermes(store=InMemorySessionStore())

    def start(self) -> dict:
        return self.hermes.start_session(
            brand_name="Acme",
            description="A modern neighborhood coffee shop.",
            goal="Increase qualified local visits",
            reference="Warm, specific, and grounded",
        )

    def reject_two(self, session_id: str) -> dict:
        return self.hermes.handle_rejection(
            session_id,
            rejections=[
                Rejection(2, "too_loud", "Reduce hype"),
                Rejection(3, "not_authentic", "Keep it grounded"),
            ],
        )

    def test_full_lifecycle_requires_refinement(self) -> None:
        session = self.start()
        with self.assertRaises(InvalidSessionStateError):
            self.hermes.approve(session["session_id"])

        refined = self.reject_two(session["session_id"])
        self.assertEqual(refined["status"], "refined_ready")
        self.assertEqual(refined["refined_direction"]["id"], 10)

        approved = self.hermes.approve(session["session_id"])
        self.assertEqual(approved["status"], "approved")

        executed = self.hermes.execute(session["session_id"])
        repeated = self.hermes.execute(session["session_id"])
        self.assertEqual(executed, repeated)
        self.assertEqual(executed["status"], "executed")

    def test_rejection_requires_exactly_two_distinct_directions(self) -> None:
        session_id = self.start()["session_id"]
        invalid_sets = [
            [Rejection(2, "too_loud")],
            [Rejection(2, "too_loud"), Rejection(2, "not_authentic")],
            [
                Rejection(1, "too_generic"),
                Rejection(2, "too_loud"),
                Rejection(3, "not_authentic"),
            ],
        ]
        for rejections in invalid_sets:
            with self.subTest(rejections=rejections):
                with self.assertRaises(InvalidSessionStateError):
                    self.hermes.handle_rejection(session_id, rejections=rejections)

    def test_rejection_rejects_unknown_direction_without_mutation(self) -> None:
        session = self.start()
        with self.assertRaises(DirectionNotFoundError):
            self.hermes.handle_rejection(
                session["session_id"],
                rejections=[
                    Rejection(2, "too_loud"),
                    Rejection(999, "not_authentic"),
                ],
            )
        unchanged = self.hermes.get_session(session["session_id"])
        self.assertEqual(unchanged["rejections"], [])
        self.assertEqual(unchanged["status"], "active")

    def test_rejection_cannot_run_after_refinement(self) -> None:
        session = self.start()
        self.reject_two(session["session_id"])
        with self.assertRaises(InvalidSessionStateError):
            self.reject_two(session["session_id"])
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd backend
python3.11 -m unittest tests.test_hermes -v
```

Expected: failures because one rejection is accepted, duplicate/unknown IDs are not rejected, approval from `active` succeeds, and `refined_ready` still accepts rejection.

- [ ] **Step 3: Implement strict validation before mutation**

Change `Hermes.handle_rejection` to accept only `rejections: list[Rejection]`, validate count/distinct IDs/existence before assigning `session.rejections`, and make `_get_active_session` accept only `active`:

```python
def handle_rejection(self, session_id: str, rejections: list[Rejection]) -> dict:
    with self._lock:
        session = self._get_active_session(session_id)
        if len(rejections) != 2:
            raise InvalidSessionStateError("Exactly two rejections are required.")

        rejected_ids = [rejection.direction_id for rejection in rejections]
        if len(set(rejected_ids)) != 2:
            raise InvalidSessionStateError("Rejected directions must be distinct.")

        available_ids = {direction.id for direction in session.directions}
        unknown_ids = set(rejected_ids) - available_ids
        if unknown_ids:
            raise DirectionNotFoundError(
                f"Unknown direction id: {min(unknown_ids)}."
            )

        session.rejections = list(rejections)
        session.constraints = self._critic_agent.extract_constraints_structured(
            brand_name=session.brand_name,
            description=session.description,
            goal=session.goal,
            dna=session.dna,
            rejections=session.rejections,
        )
        base = self._pick_base_direction(session)
        session.refined_direction = self._direction_agent.refine(
            session=session,
            base_direction=base,
            constraints=session.constraints,
        )
        session.status = "refined_ready"
        session.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self._persist(session)
        return self._serialize(session)
```

Restrict approval and rejection transitions:

```python
if session.status != "refined_ready":
    raise InvalidSessionStateError(
        f"Session is {session.status} and cannot be approved."
    )

def _get_active_session(self, session_id: str) -> CreativeSession:
    session = self._get_session(session_id)
    if session.status != "active":
        raise InvalidSessionStateError(
            f"Session is already {session.status} and cannot be changed."
        )
    return session
```

Remove unused legacy imports and free-text regeneration path.

- [ ] **Step 4: Run tests and verify GREEN**

Run `python3.11 -m unittest tests.test_hermes -v` from `backend`.

Expected: all Hermes tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/hermes.py backend/tests/test_hermes.py
git commit -m "fix: enforce creative workflow lifecycle"
```

### Task 2: Publish and verify the FastAPI contract

**Files:**
- Create: `backend/tests/test_creative_api.py`
- Modify: `backend/app/api/creative.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Write failing API contract tests**

Use FastAPI dependency overrides so every test owns an in-memory Hermes instance:

```python
import unittest

from fastapi.testclient import TestClient

from app.api.creative import get_hermes
from app.core.hermes import Hermes
from app.main import app
from app.persistence.session_store import InMemorySessionStore


class CreativeApiTests(unittest.TestCase):
    def setUp(self) -> None:
        coordinator = Hermes(store=InMemorySessionStore())
        app.dependency_overrides[get_hermes] = lambda: coordinator
        self.client = TestClient(app)
        self.addCleanup(app.dependency_overrides.clear)

    def start(self) -> dict:
        response = self.client.post(
            "/creative/start",
            json={
                "brand_name": "Northstar Coffee",
                "description": "Coffee for busy creative teams.",
                "goal": "Increase qualified local visits",
                "reference": "Warm and useful",
            },
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_start_returns_complete_typed_session(self) -> None:
        payload = self.start()
        self.assertEqual(payload["status"], "active")
        self.assertEqual(len(payload["dna"]["beliefs"]), 3)
        self.assertEqual(len(payload["directions"]), 3)
        self.assertIn("updated_at", payload)

    def test_reject_requires_exactly_two_items(self) -> None:
        session = self.start()
        response = self.client.post(
            "/creative/reject",
            json={
                "session_id": session["session_id"],
                "rejections": [{"direction_id": 2, "reason": "too_loud"}],
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_unknown_direction_and_invalid_transition_return_409(self) -> None:
        session = self.start()
        bad_direction = self.client.post(
            "/creative/reject",
            json={
                "session_id": session["session_id"],
                "rejections": [
                    {"direction_id": 2, "reason": "too_loud"},
                    {"direction_id": 999, "reason": "not_authentic"},
                ],
            },
        )
        early_approval = self.client.post(
            "/creative/approve", json={"session_id": session["session_id"]}
        )
        self.assertEqual(bad_direction.status_code, 409)
        self.assertEqual(early_approval.status_code, 409)

    def test_missing_session_returns_404(self) -> None:
        response = self.client.post(
            "/creative/execute",
            json={"session_id": "00000000-0000-0000-0000-000000000000"},
        )
        self.assertEqual(response.status_code, 404)
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd backend
python3.11 -m unittest tests.test_creative_api -v
```

Expected: import failure for `get_hermes` and rejection-length contract mismatch.

- [ ] **Step 3: Add explicit models and dependency injection**

In `creative.py`:

```python
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints

from app.core.hermes import (
    DirectionNotFoundError,
    Hermes,
    InvalidSessionStateError,
    SessionNotFoundError,
    hermes,
)
from app.core.types import Rejection

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
SessionStatus = Literal["active", "refined_ready", "approved", "executed"]
RejectionReason = Literal[
    "too_generic", "too_loud", "not_our_audience", "not_authentic", "other"
]


class ToneSliderResponse(BaseModel):
    label: str
    left: str
    right: str
    value: int


class BrandDnaResponse(BaseModel):
    beliefs: tuple[str, str, str]
    tone_sliders: tuple[ToneSliderResponse, ToneSliderResponse]


class DirectionResponse(BaseModel):
    id: int
    name: str
    tone: str
    visual_style: str
    creative_intent: str
    palette: list[str]
    channels: list[str]
    why_it_works: str


class RejectionModel(BaseModel):
    direction_id: int = Field(ge=1)
    reason: RejectionReason
    note: NonEmptyString | None = Field(default=None, max_length=240)


class ArtifactResponse(BaseModel):
    caption: str
    layout_mock_svg: str
    rationale: tuple[str, str, str]


class CreativeSessionResponse(BaseModel):
    session_id: str
    brand_name: str
    description: str
    goal: str | None
    reference: str | None
    dna: BrandDnaResponse
    directions: list[DirectionResponse]
    round: int
    status: SessionStatus
    rejections: list[RejectionModel]
    constraints: list[str]
    refined_direction: DirectionResponse | None
    artifact: ArtifactResponse | None
    updated_at: str


class ExecuteResponse(BaseModel):
    session_id: str
    status: Literal["executed"]
    artifact: ArtifactResponse
    direction: DirectionResponse


def get_hermes() -> Hermes:
    return hermes


HermesDependency = Annotated[Hermes, Depends(get_hermes)]
```

Keep existing start request limits. Replace reject request with exactly two items:

```python
class RejectDirectionRequest(BaseModel):
    session_id: NonEmptyString
    rejections: list[RejectionModel] = Field(min_length=2, max_length=2)
```

Add `coordinator: HermesDependency`, `response_model=...`, and exception mapping to each route. Reject maps both `InvalidSessionStateError` and `DirectionNotFoundError` to `409`:

```python
@router.post(
    "/reject",
    response_model=CreativeSessionResponse,
)
def reject_direction(
    request: RejectDirectionRequest, coordinator: HermesDependency
) -> dict:
    try:
        return coordinator.handle_rejection(
            request.session_id,
            rejections=[Rejection(**item.model_dump()) for item in request.rejections],
        )
    except SessionNotFoundError as exc:
        raise HTTPException(404, "Creative session not found.") from exc
    except (InvalidSessionStateError, DirectionNotFoundError) as exc:
        raise HTTPException(409, str(exc)) from exc
```

Apply the same injected coordinator pattern to start, approve, and execute. Add explicit `httpx>=0.28,<1.0` to requirements for `TestClient`.

- [ ] **Step 4: Run API and Hermes tests**

Run:

```bash
cd backend
python3.11 -m unittest discover -s tests -v
```

Expected: all tests pass and OpenAPI generation succeeds.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/creative.py backend/requirements.txt backend/tests/test_creative_api.py
git commit -m "feat: publish typed creative API contract"
```

### Task 3: Make artifact SVG safe

**Files:**
- Create: `backend/tests/test_content_agent.py`
- Modify: `backend/app/agents/content_agent.py`

- [ ] **Step 1: Write a failing hostile-input test**

```python
import unittest

from app.core.hermes import Hermes
from app.core.types import Rejection
from app.persistence.session_store import InMemorySessionStore


class ContentAgentSafetyTests(unittest.TestCase):
    def test_svg_escapes_user_controlled_markup(self) -> None:
        hermes = Hermes(store=InMemorySessionStore())
        session = hermes.start_session(
            brand_name='Bad </text><image href="x" onerror="alert(1)">',
            description="A valid hostile-input test description.",
            goal="Increase safe artifact generation",
        )
        hermes.handle_rejection(
            session["session_id"],
            rejections=[
                Rejection(2, "too_loud"),
                Rejection(3, "not_authentic"),
            ],
        )
        hermes.approve(session["session_id"])
        svg = hermes.execute(session["session_id"])["artifact"]["layout_mock_svg"]

        self.assertNotIn("<image", svg.lower())
        self.assertNotIn("onerror=", svg.lower())
        self.assertIn("&lt;/text&gt;", svg.lower())
```

- [ ] **Step 2: Run and verify RED**

Run `python3.11 -m unittest tests.test_content_agent -v` from `backend`.

Expected: hostile `<image>` and `onerror` strings appear in generated SVG.

- [ ] **Step 3: Escape every dynamic SVG value**

Import `escape` and normalize text before SVG interpolation:

```python
from xml.sax.saxutils import escape


def svg_text(value: object) -> str:
    return escape(str(value), {'"': "&quot;", "'": "&apos;"})
```

In `generate`, compute escaped variables and use only those in the SVG template:

```python
safe_brand = svg_text(brand.upper())
safe_headline = svg_text(direction.name)
safe_subhead = svg_text(direction.creative_intent)
safe_tone = svg_text(direction.tone)
safe_visual = svg_text(direction.visual_style)
safe_channels = svg_text(", ".join(direction.channels))
safe_palette = [svg_text(color) for color in direction.palette]
```

- [ ] **Step 4: Run safety and full backend tests**

Run `python3.11 -m unittest discover -s tests -v`.

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/content_agent.py backend/tests/test_content_agent.py
git commit -m "fix: escape dynamic SVG artifact content"
```

### Task 4: Establish Python and local-only Supabase guardrails

**Files:**
- Create: `AGENTS.md`
- Create: `.gitignore`
- Create: `backend/.python-version`
- Create: `backend/app/__init__.py`
- Create: `backend/tests/test_runtime.py`
- Create: `supabase/config.toml` via `supabase init`
- Create: `supabase/manual/rollback_creative_sessions.sql`
- Create: `backend/tests/test_supabase_store.py`
- Modify: `backend/.gitignore`
- Modify: `client/AGENTS.md`
- Delete: `supabase/migrations/20260718100738_drop_creative_sessions.sql`

- [ ] **Step 1: Add a runtime-version test and verify RED under static inspection**

Add to `backend/tests/test_runtime.py`:

```python
import pathlib
import unittest


class RuntimeContractTests(unittest.TestCase):
    def test_python_version_file_requires_311(self) -> None:
        version = pathlib.Path(".python-version").read_text().strip()
        self.assertTrue(version.startswith("3.11"), version)
```

Run `cd backend && python3.11 -m unittest tests.test_runtime -v`.

Expected: error because `.python-version` does not exist.

- [ ] **Step 2: Add Python 3.11 enforcement**

Create `backend/.python-version` with `3.11`. Create `backend/app/__init__.py`:

```python
import sys

if sys.version_info < (3, 11):
    raise RuntimeError("Creative Curator backend requires Python 3.11 or newer.")
```

Run runtime test; expected PASS.

- [ ] **Step 3: Add repository and agent safety rules**

Create root `.gitignore`:

```gitignore
.superpowers/
supabase/.temp/
```

Extend `backend/.gitignore` with `.env.local`. Create root `AGENTS.md` containing:

```markdown
# Creative Curator agent guide

## Authoritative documentation

- Product/client behavior: `docs/CLIENT_FLOW.md`
- HTTP contract and state rules: `docs/API.md`
- Local persistence: `docs/SUPABASE.md`
- Setup and verification: `README.md`
- Architecture history: `docs/DEVLOG.md`

Update the owning document whenever public behavior, API shapes, workflow states,
setup commands, or persistence behavior changes. Code and docs ship together.

## Supabase safety

Development uses local Supabase only. Never run `supabase link`, `supabase db push`,
linked migrations, or any command that mutates a remote Supabase project without
explicit user approval. Tests must use the in-memory store or a URL proven to be
localhost/127.0.0.1.

## Runtime

Backend requires Python 3.11+. Frontend uses Next.js 16; also follow
`client/AGENTS.md` before changing client code.
```

Append to `client/AGENTS.md`:

```markdown

## Project contracts

Read root `AGENTS.md`, `docs/CLIENT_FLOW.md`, and `docs/API.md` before changing
workspace behavior or API integration. Update those docs with contract changes.
```

- [ ] **Step 4: Initialize local Supabase without linking**

Run from repository root:

```bash
supabase init
```

Expected: local `supabase/config.toml` created; no remote project reference or link metadata. Set `project_id = "creative-curator"` if generated value differs.

Move rollback SQL to `supabase/manual/rollback_creative_sessions.sql` using a patch and delete the timestamped drop migration. Verify only the create migration remains:

```bash
find supabase/migrations -maxdepth 1 -type f -print
```

Expected: only `20260718100737_create_creative_sessions.sql`.

- [ ] **Step 5: Write a guarded local persistence integration test**

Create `backend/tests/test_supabase_store.py`:

```python
import os
import unittest
from urllib.parse import urlparse
from uuid import uuid4

from app.persistence.session_store import SupabaseSessionStore


class LocalSupabaseStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.url = os.getenv("SUPABASE_LOCAL_TEST_URL", "")
        cls.key = os.getenv("SUPABASE_LOCAL_TEST_KEY", "")
        if not cls.url or not cls.key:
            raise unittest.SkipTest("Local Supabase test variables are not set.")
        if urlparse(cls.url).hostname not in {"127.0.0.1", "localhost"}:
            raise RuntimeError("Refusing to run persistence test against non-local Supabase.")

    def test_create_load_and_update(self) -> None:
        store = SupabaseSessionStore(self.url, self.key)
        session_id = str(uuid4())
        initial = {
            "session_id": session_id,
            "brand_name": "Local Test",
            "description": "Local persistence integration test.",
            "goal": None,
            "status": "active",
        }
        store.create(session_id, initial)
        self.assertEqual(store.get(session_id), initial)

        updated = {**initial, "status": "approved"}
        store.save(session_id, updated)
        self.assertEqual(store.get(session_id), updated)
```

- [ ] **Step 6: Start and verify local Supabase only**

Run:

```bash
supabase start
supabase db reset --local
supabase status -o env
```

Copy local API URL and anon key into ignored `backend/.env.local` and into shell-only `SUPABASE_LOCAL_TEST_URL` / `SUPABASE_LOCAL_TEST_KEY`. Never copy the remote `.env` values.

Run:

```bash
cd backend
SUPABASE_LOCAL_TEST_URL=http://127.0.0.1:54321 \
SUPABASE_LOCAL_TEST_KEY="$LOCAL_ANON_KEY" \
python3.11 -m unittest tests.test_supabase_store -v
```

Expected: create/load/update test passes against local Docker Supabase.

- [ ] **Step 7: Commit**

```bash
git add .gitignore AGENTS.md backend/.gitignore backend/.python-version \
  backend/app/__init__.py backend/tests/test_runtime.py \
  backend/tests/test_supabase_store.py client/AGENTS.md supabase/config.toml \
  supabase/manual/rollback_creative_sessions.sql \
  supabase/migrations/20260718100738_drop_creative_sessions.sql
git commit -m "chore: establish local development guardrails"
```

### Task 5: Create the browser E2E test before frontend implementation

**Files:**
- Create: `client/playwright.config.ts`
- Create: `client/e2e/guided-workspace.spec.ts`
- Modify: `client/package.json`
- Modify: `client/package-lock.json`

- [ ] **Step 1: Install Playwright test runner**

Run:

```bash
cd client
npm install --save-dev @playwright/test
npx playwright install chromium
```

Add scripts:

```json
"test:e2e": "playwright test",
"test:e2e:headed": "playwright test --headed"
```

- [ ] **Step 2: Configure real backend and frontend servers**

Create `client/playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "cd ../backend && python3.11 -m uvicorn app.main:app --host 127.0.0.1 --port 8100",
      port: 8100,
      reuseExistingServer: false,
      env: { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    },
    {
      command: "BACKEND_URL=http://127.0.0.1:8100 npm run dev -- --hostname 127.0.0.1 --port 3100",
      port: 3100,
      reuseExistingServer: false,
    },
  ],
});
```

- [ ] **Step 3: Write the failing happy-path browser test**

```typescript
import { expect, test } from "@playwright/test";

test("guided workspace completes the Hermes creative loop", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Brand name").fill("Northstar Coffee");
  await page
    .getByLabel("One-sentence description")
    .fill("A premium coffee brand for busy city mornings.");
  await page.getByLabel("Optional goal").fill("Increase qualified local visits");
  await page.getByLabel("Optional reference").fill("Warm, useful, and confident");
  await page.getByRole("button", { name: "Generate directions" }).click();

  await expect(page.getByRole("button", { name: /DNA/ })).toBeEnabled();
  await page.getByRole("button", { name: /DNA/ }).click();
  await expect(page.getByRole("heading", { name: "Brand DNA" })).toBeVisible();

  await page.getByRole("button", { name: /Outputs/ }).click();
  await expect(page.getByRole("heading", { name: "Three creative directions" })).toBeVisible();
  await expect(page.locator("article[data-direction-id]")).toHaveCount(3);

  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Reject Internet Chaos").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();
  await expect(page.getByRole("heading", { name: /Refined/ })).toBeVisible();

  await page
    .getByRole("button", { name: "Approve and generate artifact" })
    .click();
  await expect(page.getByRole("heading", { name: "Final artifact" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Generated creative layout" })).toBeVisible();
});
```

- [ ] **Step 4: Run and verify RED**

Run `npm run test:e2e`.

Expected: test fails at `Brand name` because root still renders placeholder chat workspace.

- [ ] **Step 5: Commit failing E2E specification**

```bash
git add client/package.json client/package-lock.json client/playwright.config.ts client/e2e/guided-workspace.spec.ts
git commit -m "test: specify guided workspace browser flow"
```

### Task 6: Add typed frontend API and shared session state

**Files:**
- Create: `client/app/lib/creative-api.ts`
- Create: `client/app/components/workspace-context.tsx`

- [ ] **Step 1: Implement one API contract module**

Create types matching `CreativeSessionResponse`, plus `ApiError`, and these exports:

```typescript
export type SessionStatus = "active" | "refined_ready" | "approved" | "executed";
export type RejectionReason =
  | "too_generic"
  | "too_loud"
  | "not_our_audience"
  | "not_authentic"
  | "other";

export type StartSessionInput = {
  brand_name: string;
  description: string;
  goal: string | null;
  reference: string | null;
};

export type RejectionInput = {
  direction_id: number;
  reason: RejectionReason;
  note: string | null;
};

export type ToneSlider = {
  label: string;
  left: string;
  right: string;
  value: number;
};

export type BrandDna = {
  beliefs: [string, string, string];
  tone_sliders: [ToneSlider, ToneSlider];
};

export type Direction = {
  id: number;
  name: string;
  tone: string;
  visual_style: string;
  creative_intent: string;
  palette: string[];
  channels: string[];
  why_it_works: string;
};

export type Rejection = RejectionInput;

export type Artifact = {
  caption: string;
  layout_mock_svg: string;
  rationale: [string, string, string];
};

export type CreativeSession = {
  session_id: string;
  brand_name: string;
  description: string;
  goal: string | null;
  reference: string | null;
  dna: BrandDna;
  directions: Direction[];
  round: number;
  status: SessionStatus;
  rejections: Rejection[];
  constraints: string[];
  refined_direction: Direction | null;
  artifact: Artifact | null;
  updated_at: string;
};

export type ExecuteResponse = {
  session_id: string;
  status: "executed";
  artifact: Artifact;
  direction: Direction;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function postJson<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`/api/creative${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = Array.isArray(payload?.detail)
      ? payload.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(" ")
      : payload?.detail;
    throw new ApiError(response.status, detail || "Creative service unavailable.");
  }
  return payload as T;
}

export const creativeApi = {
  start: (input: StartSessionInput) => postJson<CreativeSession>("/start", input),
  reject: (sessionId: string, rejections: RejectionInput[]) =>
    postJson<CreativeSession>("/reject", { session_id: sessionId, rejections }),
  approve: (sessionId: string) =>
    postJson<CreativeSession>("/approve", { session_id: sessionId }),
  execute: (sessionId: string) =>
    postJson<ExecuteResponse>("/execute", { session_id: sessionId }),
};
```

- [ ] **Step 2: Implement provider operations**

Create a client context exposing:

```typescript
type WorkspaceView = "brief" | "dna" | "outputs";
type Operation = "start" | "reject" | "approve" | "execute" | null;

type WorkspaceContextValue = {
  session: CreativeSession | null;
  activeView: WorkspaceView;
  operation: Operation;
  error: string;
  setActiveView(view: WorkspaceView): void;
  start(input: StartSessionInput): Promise<void>;
  reject(rejections: RejectionInput[]): Promise<void>;
  approveAndExecute(): Promise<void>;
  retryExecute(): Promise<void>;
  reset(): void;
};
```

Rules:

- `start` sets session and moves to `dna` only after success.
- `reject` sets returned session and stays in `outputs`.
- `approveAndExecute` stores approved session before executing; on execute failure status remains `approved` so retry is possible.
- Successful execute merges returned artifact/status into current session.
- `reset` clears session/error and returns to `brief`.
- `setActiveView` refuses `dna`/`outputs` while session is null.
- Every operation clears old error, sets operation, catches `ApiError`/network errors into user-readable text, and clears operation in `finally`.

- [ ] **Step 3: Run static checks**

Run `npm run lint` and `npx tsc --noEmit`.

Expected: pass for new isolated modules.

- [ ] **Step 4: Commit**

```bash
git add client/app/lib/creative-api.ts client/app/components/workspace-context.tsx
git commit -m "feat: add creative session client state"
```

### Task 7: Replace placeholder shell with guided views

**Files:**
- Create: `client/app/components/brief-view.tsx`
- Create: `client/app/components/dna-view.tsx`
- Create: `client/app/components/outputs-view.tsx`
- Modify: `client/app/components/creative-shell.tsx`
- Modify: `client/app/page.module.css`
- Modify: `client/app/page.tsx`
- Modify: `client/package.json`
- Modify: `client/package-lock.json`

- [ ] **Step 1: Build Brief view from approved contract**

Use controlled fields with exact API limits:

```tsx
<input aria-label="Brand name" maxLength={80} required />
<textarea aria-label="One-sentence description" minLength={5} maxLength={280} required />
<input aria-label="Optional goal" minLength={10} maxLength={500} />
<input aria-label="Optional reference" maxLength={240} />
```

Submit trimmed values through provider `start`; preserve local form values after errors. When a session exists, display a read-only brief summary plus Start over rather than creating another session accidentally.

- [ ] **Step 2: Build DNA view from session data**

Render `session.dna.beliefs` and `tone_sliders` only. Clamp visual slider position with `Math.min(100, Math.max(0, slider.value))`. No static trait text remains.

- [ ] **Step 3: Build Outputs view and safe artifact image**

Render three direction articles with `data-direction-id={direction.id}`. Keep rejection drafts local to Outputs so failed requests preserve them. Disable a third checkbox after two selections. Each checkbox uses `aria-label={`Reject ${direction.name}`}` so the browser test and screen readers identify it. Submit exactly two `RejectionInput` values.

For `refined_ready`, render refined direction and `Approve and generate artifact`. For `approved`, render `Generate artifact` retry. For `executed`, render caption/rationale and:

```tsx
import Image from "next/image";

const artifactUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  session.artifact.layout_mock_svg,
)}`;

<Image
  alt="Generated creative layout"
  height={1080}
  src={artifactUrl}
  unoptimized
  width={1080}
/>
```

Never use `dangerouslySetInnerHTML`.

- [ ] **Step 4: Reduce shell navigation to real views**

Replace `chat | dna | outputs | scheduler | settings` with `brief | dna | outputs`. Wrap shell in `WorkspaceProvider`; mark DNA/Outputs buttons disabled until session exists. Display current session status and progression. Remove `@xyflow/react` imports and run:

```bash
npm uninstall @xyflow/react
```

Remove fake replies, static DNA, canvas nodes, Scheduler, Settings, and API-key field. Keep responsive drawer behavior and existing visual language.

- [ ] **Step 5: Rework CSS for guided content**

Reuse current color/type tokens. Add layouts for brief form, beliefs/sliders, three direction cards, rejection controls, refined card, artifact image, status/error banner, disabled nav, and mobile stacking. Delete canvas/scheduler/settings-only rules after `rg` proves no remaining JSX references.

- [ ] **Step 6: Run E2E and verify GREEN**

Run:

```bash
npm run lint
npx tsc --noEmit
npm run test:e2e
```

Expected: happy-path browser test passes through real backend.

- [ ] **Step 7: Commit**

```bash
git add client/app/components client/app/page.tsx client/app/page.module.css \
  client/package.json client/package-lock.json
git commit -m "feat: connect guided workspace to Hermes"
```

### Task 8: Prove error retention and execution retry

**Files:**
- Modify: `client/e2e/guided-workspace.spec.ts`
- Modify: `client/app/components/workspace-context.tsx`
- Modify: `client/app/components/brief-view.tsx`
- Modify: `client/app/components/outputs-view.tsx`

- [ ] **Step 1: Add a failing validation-retention test**

```typescript
test("brief keeps user input when backend validation fails", async ({ page }) => {
  await page.route("**/api/creative/start", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Brief validation failed." }),
    });
  });
  await page.goto("/");
  await page.getByLabel("Brand name").fill("Northstar Coffee");
  await page.getByLabel("One-sentence description").fill("Valid description");
  await page.getByLabel("Optional goal").fill("Increase qualified local visits");
  await page.getByRole("button", { name: "Generate directions" }).click();

  await expect(page.getByRole("status")).toContainText("Brief validation failed");
  await expect(page.getByLabel("Brand name")).toHaveValue("Northstar Coffee");
  await expect(page.getByLabel("Optional goal")).toHaveValue(
    "Increase qualified local visits",
  );
});
```

Run this test alone. Expected: RED until server detail normalization and persistent form behavior match.

- [ ] **Step 2: Add a failing execute-retry test**

Intercept only the first execute request, then let the real backend handle retry:

```typescript
test("artifact generation retries without approving twice", async ({ page }) => {
  let executeAttempts = 0;
  await page.route("**/api/creative/execute", async (route) => {
    executeAttempts += 1;
    if (executeAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Artifact service unavailable." }),
      });
    } else {
      await route.continue();
    }
  });

  // Use a shared test helper to start and refine a session through the UI.
  await startAndRefine(page);
  await page.getByRole("button", { name: "Approve and generate artifact" }).click();
  await expect(page.getByRole("status")).toContainText("Artifact service unavailable");
  await page.getByRole("button", { name: "Generate artifact" }).click();
  await expect(page.getByRole("heading", { name: "Final artifact" })).toBeVisible();
  expect(executeAttempts).toBe(2);
});
```

Run test alone. Expected: RED if provider retries approval or loses approved state.

- [ ] **Step 3: Implement minimal error normalization/retry corrections**

Keep state changes exactly as specified in Task 6. Ensure error region uses `role="status" aria-live="polite"`; clear errors only when a new operation begins or reset occurs. Extract `startAndRefine(page)` in the test file to remove duplicated browser steps.

- [ ] **Step 4: Run full client checks**

Run `npm run lint`, `npx tsc --noEmit`, and `npm run test:e2e`.

Expected: all browser scenarios pass.

- [ ] **Step 5: Commit**

```bash
git add client/e2e/guided-workspace.spec.ts client/app/components
git commit -m "test: cover workspace failures and retry"
```

### Task 9: Retire the legacy route and prove placeholder removal

**Files:**
- Modify: `client/app/studio/page.tsx`
- Delete: `client/app/studio/legacy-workflow.tsx`
- Modify: `client/e2e/guided-workspace.spec.ts`

- [ ] **Step 1: Add failing redirect and placeholder tests**

```typescript
test("legacy studio redirects to guided workspace", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: /Shape the brief/i })).toBeVisible();
});

test("workspace contains no disconnected prototype controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Placeholder reply", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Scheduler", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Provide API key", { exact: true })).toHaveCount(0);
});
```

Run both; expected RED because `/studio` still renders legacy page.

- [ ] **Step 2: Redirect and delete duplicate workflow**

Replace `client/app/studio/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function StudioPage() {
  redirect("/");
}
```

Delete `legacy-workflow.tsx`. Verify dangerous/placeholder code is gone:

```bash
rg -n "dangerouslySetInnerHTML|Placeholder reply|Scheduler|Provide API key" client/app
```

Expected: no matches.

- [ ] **Step 3: Run tests and commit**

Run `npm run lint`, `npx tsc --noEmit`, and `npm run test:e2e`; expected PASS.

```bash
git add client/app/studio client/e2e/guided-workspace.spec.ts
git commit -m "refactor: retire legacy creative workflow"
```

### Task 10: Synchronize documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/API.md`
- Modify: `docs/CLIENT_FLOW.md`
- Modify: `docs/DEVLOG.md`
- Modify: `docs/DEMO_TUTORIAL.md`
- Modify: `docs/SUPABASE.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Update setup and local persistence docs**

README commands must use Python 3.11 and explicit env selection:

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

Local Supabase section must use only:

```bash
supabase start
supabase db reset --local
supabase status -o env
cd backend
uvicorn app.main:app --reload --env-file .env.local
```

State clearly that remote linking/push is forbidden without explicit approval and permissive RLS hardening is deferred.

- [ ] **Step 2: Make API and client-flow docs authoritative**

`API.md` documents exact request/response fields, exactly-two rejection invariant, lifecycle, `404`/`409`/`422`, and execute idempotency. Remove legacy `reasons` support and approval-skipping language.

`CLIENT_FLOW.md` documents `/` Guided Workspace, Brief/DNA/Outputs unlock behavior, errors/retry, Start over, refresh loss, and `/studio` redirect. Remove the claim that workflow lives in one `page.tsx` component.

- [ ] **Step 3: Update narrative/demo index**

`DEVLOG.md` records Guided Workspace/Hermes integration, local-only Supabase decision, Python 3.11, SVG safety, and deferred auth/dashboard/recovery/remote hardening. `DEMO_TUTORIAL.md` walks through the root route. `docs/README.md` names authoritative owners.

- [ ] **Step 4: Verify docs contain required contracts**

Run:

```bash
rg -n "Python 3.11|supabase start|db reset --local" README.md docs
rg -n "exactly two|refined_ready|409|422|idempotent" docs/API.md
rg -n "Brief|DNA|Outputs|refresh|Start over" docs/CLIENT_FLOW.md
rg -n "Never run.*supabase link|remote Supabase" AGENTS.md docs/SUPABASE.md
```

Expected: every command finds the intended current guidance; no docs instruct opening `/studio` for the main demo.

- [ ] **Step 5: Commit**

```bash
git add README.md docs
git commit -m "docs: align guided workspace contracts"
```

### Task 11: Full verification and completion audit

**Files:**
- Modify only if verification reveals defects in already-covered behavior.

- [ ] **Step 1: Run backend suite under Python 3.11**

```bash
cd backend
python3.11 -m unittest discover -s tests -v
```

Expected: all mandatory tests pass; local Supabase test reports SKIP unless explicit local test variables are provided.

- [ ] **Step 2: Run optional local persistence test**

With local Supabase running and local anon key exported:

```bash
SUPABASE_LOCAL_TEST_URL=http://127.0.0.1:54321 \
SUPABASE_LOCAL_TEST_KEY="$LOCAL_ANON_KEY" \
python3.11 -m unittest tests.test_supabase_store -v
```

Expected: PASS. Confirm `supabase status` reports local URLs only.

- [ ] **Step 3: Run frontend static and browser checks**

```bash
cd client
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```

Expected: all pass; browser suite uses in-memory backend on ports 8100/3100.

- [ ] **Step 4: Audit explicit requirements**

Run:

```bash
rg -n "dangerouslySetInnerHTML|Placeholder reply|Scheduler|Provide API key" client/app
find supabase/migrations -maxdepth 1 -type f -print
git status --short
```

Expected: first command has no matches; migrations contains only create migration; worktree contains no accidental `.env`, `.superpowers`, or `supabase/.temp` files.

Manually confirm:

- Root UI completes Brief → DNA → Outputs → Refine → Artifact.
- Hermes rejects invalid transitions/directions.
- Frontend/backend fields and statuses match documented API.
- Python 3.11 is enforced/documented.
- SVG is escaped and rendered as image, never live markup.
- No remote Supabase command ran; local persistence passed.
- README/API/client-flow/devlog/demo/Supabase docs and both AGENTS files agree.

- [ ] **Step 5: Commit verification-only fixes if needed**

If verification required a covered correction, commit only that correction with its regression test. Otherwise create no empty commit.
