# Local Brand Constellation demo

This walkthrough exercises the sole production journey: Projects → Brand Constellation → Starter Brand Blueprint. It uses local Supabase Auth and persistence, never links or mutates a remote project, and exposes no compatibility session surface. A real provider key can make live provider requests; use guarded test transport for an offline deterministic demo.

## 1. Start local Supabase

From repository root:

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Reset applies local owner-scoped spatial project, encrypted credential, versioned routing, and atomic settings migrations. It destroys local demo data. Manual rollback order is documented in [`SUPABASE.md`](SUPABASE.md). Never run `supabase link`, `supabase db push`, linked migrations, or remote mutations without explicit approval.

## 2. Start backend

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env.local
python -c 'import base64, secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())'
```

Put trusted local `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` values plus generated master key into ignored `.env.local`. Keep URL loopback-only. `LLM_TRANSPORT_MODE=live` uses saved keys for real AI. `LLM_TRANSPORT_MODE=test` accepts bounded fake `test-...` keys and makes no provider request; production forbids it.

```sh
uvicorn app.main:app --reload --env-file .env.local
```

## 3. Start client

In another terminal:

```sh
cd client
cp .env.example .env.local
npm install
npm run dev
```

Replace client anon-key placeholder with same local anon key. Open <http://localhost:3000>. Sign up with email and password of at least eight characters; local email confirmation is disabled.

## 4. Configure AI

Open **Settings**. Connect supported API-key provider, test key, choose or manually enter model, then save. Add primary route and up to five ordered fallbacks. Provider keys clear from browser state after save; UI later displays suffix only. Backend stores account/provider-bound AES-256-GCM ciphertext, never plaintext.

Missing routing returns typed `ai_configuration_required` recovery. Runtime tries primary then fallbacks in displayed order. Safe categories distinguish authentication, timeout, rate limit, unavailable service, invalid response, and configuration failure without exposing secrets or provider bodies. Authentication/decryption problems mark exact saved credential `Needs attention`.

## 5. Build a Brand Constellation

Open **Projects**, create a project, and enter any diagnostic facts or assumptions you already know. Diagnostic seeds validated Blueprint sections and recommends a useful starting area. In Constellation, capture typed nodes, assign Blueprint section/branch/cluster in Inspector, connect relationships, approve decisions, ask Hermes to challenge selected semantic scope, and explicitly accept or reject each proposal. Acknowledge records that a challenge was seen while leaving it open; resolve, defer, or override closes it. Trash remains recoverable after reload.

On desktop, use the centered eight-button icon-only dock: Select, Connect, Draw, Erase, Add thought, Add media, Undo, and Redo. Hover or keyboard-focus each control to reveal its matching tooltip. Selected-node Inspector provides `Connect nodes` and `Size & position`. Undo and Redo follow one chronology across saved graph and annotation actions. Mobile uses focused graph navigation instead of desktop dock.

Open **Blueprint** anytime. Early snapshots disclose missing decisions and unresolved blockers; ready sections require approved decisions. Export uses same canonical snapshot. Logout/login and refresh restore owner-scoped projects, graph state, settings, and snapshots. Unsaved diagnostic and explicitly documented tab-only recovery state remain local to browser scope.

## 6. Verify

```sh
cd backend
python -m unittest discover -s tests -v

eval "$(supabase status -o env)"
SUPABASE_LOCAL_TEST_URL="$API_URL" \
SUPABASE_LOCAL_TEST_KEY="$ANON_KEY" \
SUPABASE_LOCAL_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
python -m unittest tests.test_supabase_auth_settings -v

cd ../client
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```
