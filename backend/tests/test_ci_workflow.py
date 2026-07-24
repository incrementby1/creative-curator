from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


class CiWorkflowContractTests(unittest.TestCase):
    def test_ci_runs_every_mandatory_gate_on_main_and_pull_requests(self) -> None:
        self.assertTrue(WORKFLOW.is_file(), "CI workflow must be committed")
        workflow = WORKFLOW.read_text(encoding="utf-8")

        for required in (
            "pull_request:",
            "push:",
            "branches: [main]",
            "contents: read",
            "backend:",
            "client-quality:",
            "client-e2e:",
            "python -m unittest discover -s tests -v",
            "npm run lint",
            "npx tsc --noEmit",
            "npm run build",
            "npx playwright install --with-deps chromium",
            "npm run test:e2e",
        ):
            with self.subTest(required=required):
                self.assertIn(required, workflow)

    def test_ci_needs_no_secrets_or_remote_mutation(self) -> None:
        self.assertTrue(WORKFLOW.is_file(), "CI workflow must be committed")
        workflow = WORKFLOW.read_text(encoding="utf-8").casefold()

        for forbidden in (
            "secrets.",
            "supabase link",
            "supabase db push",
            "supabase migration up",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, workflow)


if __name__ == "__main__":
    unittest.main()
