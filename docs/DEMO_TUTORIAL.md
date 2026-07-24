# Local browser demo

This walkthrough uses local Supabase Auth and persistence. It never links or mutates a remote project. A real provider key can make live provider requests; use guarded test transport only for an offline deterministic demo.

## 1. Start local Supabase

From repository root:

```sh
supabase start
supabase db reset --local
supabase status -o env
```

Reset applies local owner/session, encrypted credential, versioned routing, and atomic settings migrations. It destroys local demo data. Manual rollback order is documented in [`SUPABASE.md`](SUPABASE.md). Never run `supabase link`, `supabase db push`, linked migrations, or remote mutations without explicit approval.

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

## 5. Run Guided Workspace

Enter brand, description, optional goal, and reference. Review Brand DNA and three directions; reject exactly two; approve refined survivor; generate artifact. Client navigation to Settings and back keeps drafts/session.

Logout/login restores local account and owner-scoped AI settings. Browser refresh does **not** restore creative work: saved-session listing/recovery is not implemented even though backend session rows persist. Start over after lost browser state.

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
