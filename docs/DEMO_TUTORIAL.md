# Demo tutorial

Run local Guided Workspace: Brief → DNA → three directions → reject two → refined direction → approval → final artifact.

## Start locally

Terminal A, in-memory default:

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

No environment file or Supabase setup is needed. On Windows PowerShell, activate with `./.venv/Scripts/Activate.ps1`.

Terminal B:

```sh
cd client
npm install
npm run dev
```

Open <http://localhost:3000/>. Check backend at <http://127.0.0.1:8000/health> if needed. `/studio` redirects to root workspace.

## Walkthrough

1. In **Brief**, enter `Northstar Coffee` and `Neighborhood coffee shop with a small seasonal menu.` Add optional goal/reference if useful, then select **Generate directions**.
2. Open **DNA**. Read three beliefs and two read-only tone meters; this is Hermes' current hypothesis.
3. Open **Outputs**. Compare direction cards. Reject exactly two, choose reason for each, optionally write notes, then select **Refine remaining direction**.
4. Review refined direction and constraints. Select **Approve and generate artifact**.
5. Inspect caption, safe SVG layout image, and three rationale points.

If artifact generation fails after approval, select **Generate artifact**. This retries execute only; it does not approve twice. **Start over** clears current session and output, returns to Brief, and retains controlled Brief values for editing or resubmission. Refresh intentionally starts a new browser session.

## Optional local Supabase

Only if persistence is needed, follow [`SUPABASE.md`](SUPABASE.md). Use local Supabase only; this demo never needs remote project setup.
