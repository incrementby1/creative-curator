# Creative Curator

Creative Curator is a nonlinear spatial brand-development workspace. Brand Constellation is the sole production journey: authenticated users create owner-scoped projects, build a typed graph, review Hermes proposals and challenges, and publish interactive Starter Brand Blueprints with dated PDF snapshots.

## Quick start

Requires Python 3.11+, Node.js 20.19+, and local Supabase for persistent authenticated use.

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

cd ../client
npm ci
npx playwright install chromium
```

Client manifest locks React Flow (`@xyflow/react`), Lucide (`lucide-react`), freehand drawing (`perfect-freehand`), Motion for React (`motion`), and Vitest/testing-library dependencies. No runtime component registry is used.

Follow [local persistence setup](docs/SUPABASE.md#local-setup), then start separate terminals:

```sh
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --env-file .env.local
```

```sh
cd client
npm run dev
```

Open <http://localhost:3000>. FastAPI health/docs: <http://127.0.0.1:8000/health> and <http://127.0.0.1:8000/docs>.

Production routes: `/projects`, `/projects/new`, `/projects/[projectId]`, `/projects/[projectId]/blueprint`, and `/settings`. `/` remains public whether signed in or signed out; authenticated visitors use its Projects call to action rather than an automatic redirect. Removed product URLs use normal application Not Found behavior and expose no compatibility workspace.

## Local persistence safety

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Use only trusted loopback values in ignored `.env.local` files. Never run `supabase link`, `supabase db push`, linked migrations, or remote mutations without explicit approval. See [Supabase contract](docs/SUPABASE.md) for graph tables, private media, guarded variables, cleanup, and rollback.

## Verification

Backend, from `backend/`:

```sh
python -m unittest discover -s tests -v
```

Mandatory client gates, from `client/`:

```sh
npm run lint
npx tsc --noEmit
npm run test:unit -- --run
npm run build
npm run test:e2e
```

Playwright config starts real FastAPI with in-memory stores. Clean setup requires `npx playwright install chromium`. Blueprint PDF verification uses browser print from canonical semantic HTML; tests verify version/date labels, printable source IDs, opaque high-contrast output, and hidden editor chrome.

Large-graph gate runs `npx playwright test e2e/constellation-performance.spec.ts`: 250 nodes, 400 edges, 15 paths, and 15 private media annotations. It reports render/interaction milliseconds against defined budgets; no FPS claim.

## Architecture and contracts

- `backend/app/projects/`: typed graph, owner-scoped stores, invariants, scoped analysis/cache, proposals/challenges, Blueprint compiler.
- `backend/app/api/projects.py`: authenticated project HTTP contract.
- `client/app/components/constellation/`: React Flow workbench, isolated annotation/media layer, accessible graph, mobile navigator, proposal and recovery surfaces.
- `client/app/components/blueprint/`: interactive and print-friendly Blueprint.
- `supabase/`: local migrations and manual rollback helpers.

Desktop Constellation uses an eight-button icon-only dock with hover/focus tooltips, Inspector-based connection and sizing operations, and one chronological Undo and Redo history across graph and annotation actions. Mobile uses focused graph navigation and does not render a compressed desktop dock.

Authoritative docs: [product](PRODUCT.md), [design](DESIGN.md), [client flow](docs/CLIENT_FLOW.md), [API](docs/API.md), [Supabase](docs/SUPABASE.md), [component provenance](docs/COMPONENT_PROVENANCE.md), and [history](docs/DEVLOG.md).
