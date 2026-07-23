# Demo tutorial

The browser Guided Workspace is not yet runnable at the Task 9 milestone: client authentication, bearer forwarding, and provider-settings UI arrive in Tasks 10–12. The browser walkthrough below remains pending until those tasks land. The current backend lifecycle can be verified offline with the guarded smoke flow in this document.

## Start locally

Terminal A, explicit isolated memory mode:

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
APP_ENV=test \
AUTH_MODE=test \
SETTINGS_STORE_MODE=memory \
LLM_TRANSPORT_MODE=test \
BYOK_MASTER_KEY=a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s= \
uvicorn app.main:app --reload
```

No environment file or Supabase setup is needed because every isolated mode is selected explicitly on the command line. On Windows PowerShell, activate with `./.venv/Scripts/Activate.ps1`.

Starting the client is optional at this milestone and does not enable the authenticated lifecycle:

```sh
cd client
npm install
npm run dev
```

The current client at <http://localhost:3000/> cannot authenticate or configure routing. `/studio` redirects to the root workspace, but attempting the full browser flow is expected to fail until Tasks 10–12 are complete. Backend health is available at <http://127.0.0.1:8000/health>.

## Current backend-only smoke flow

Keep Terminal A running with the guarded configuration above. In another terminal, use `curl` and `jq` to configure one deliberate fake provider key and complete the lifecycle. `LLM_TRANSPORT_MODE=test` makes provider checks and creative generation deterministic and creates no HTTP client or outbound request.

```sh
API=http://127.0.0.1:8000
AUTH='Authorization: Bearer test-user:demo-user'

curl --fail-with-body --silent --show-error \
  -X PUT "$API/settings/providers/openai-api" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"api_key":"test-demo-key","model":"openai-api-test-model","base_url":null}'

curl --fail-with-body --silent --show-error \
  -X PUT "$API/settings/routing" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"primary":{"provider_slug":"openai-api","model":"openai-api-test-model"},"fallbacks":[],"version":1}'

SESSION_ID="$(curl --fail-with-body --silent --show-error \
  -X POST "$API/creative/start" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"brand_name":"Northstar Coffee","description":"Neighborhood coffee shop with a small seasonal menu."}' \
  | jq -er '.session_id')"

curl --fail-with-body --silent --show-error \
  -X POST "$API/creative/reject" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$SESSION_ID\",\"rejections\":[{\"direction_id\":2,\"reason\":\"too_loud\",\"note\":\"Keep it quieter\"},{\"direction_id\":3,\"reason\":\"not_authentic\",\"note\":\"Stay neighborhood-led\"}]}"

curl --fail-with-body --silent --show-error \
  -X POST "$API/creative/approve" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$SESSION_ID\"}"

curl --fail-with-body --silent --show-error \
  -X POST "$API/creative/execute" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$SESSION_ID\"}" \
  | jq
```

The final response has `status: "executed"`, the refined `direction`, and a deterministic `artifact`. All state is in memory and is lost when Terminal A stops. The only credential in this flow is the intentionally fake `test-demo-key`; never substitute a real key in test transport mode.

## Pending browser walkthrough

After Tasks 10–12 add client login, bearer forwarding, and settings controls, the Guided Workspace will cover Brief → DNA → three directions → reject two → refined direction → approval → final artifact. Until then, use only the backend smoke flow above.

## Optional local Supabase

Only if persistence is needed, follow [`SUPABASE.md`](SUPABASE.md). Use local Supabase only; this demo never needs remote project setup.
