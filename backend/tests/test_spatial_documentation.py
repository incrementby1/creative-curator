from __future__ import annotations

import re
import unittest
from pathlib import Path

from app.main import app


ROOT = Path(__file__).resolve().parents[2]

FORBIDDEN_ACTIVE_DOC_PATTERNS = (
    r"/studio\b",
    r"/projects/legacy(?:/|\b)",
    r"/creative\b",
    r"/api/creative(?:/|\*)",
    r"/creative/sessions\b",
    r"(?i)\b(?:legacy|guided) workspaces?\b",
    r"(?i)\bguided sessions?\b",
    r"(?i)\bguided[- ]sessions?[- ]archives?\b",
    r"(?i)\bsaved[- ]sessions?[- ]archives?\b",
    r"(?i)\blegacy[- ]sessions?[- ]archives?\b",
    r"(?i)\blegacy[- ]pages?\b",
    r"(?i)\blegacy[- ]sessions?[- ]recover(?:y|ies)\b",
    r"(?i)\blegacy[- ]archives?\b",
    r"(?i)\bread-only legacy sessions?\b",
    r"(?i)\blegacy surfaces?\b",
)


def forbidden_active_doc_matches(text: str) -> tuple[str, ...]:
    return tuple(
        pattern for pattern in FORBIDDEN_ACTIVE_DOC_PATTERNS
        if re.search(pattern, text)
    )


class SpatialDocumentationContractTests(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_docs_define_constellation_only_production_runtime(self) -> None:
        combined = "\n".join(self.read(path) for path in (
            "PRODUCT.md", "DESIGN.md", "README.md", "docs/README.md",
            "docs/DEMO_TUTORIAL.md", "docs/CLIENT_FLOW.md", "docs/API.md",
            "docs/SUPABASE.md", "docs/INDEX.md",
        ))
        for removed in (
            "Legacy workspace", "GET /creative/sessions", "`/studio`",
            "`/projects/legacy/", "/api/creative/", "Annotation and semantic undo histories remain independent",
        ):
            with self.subTest(removed=removed):
                self.assertNotIn(removed, combined)
        self.assertEqual(forbidden_active_doc_matches(combined), ())
        self.assertIn("one chronological Undo and Redo history", combined)
        self.assertIn("icon-only", combined)
        for token in ("Select", "Connect", "Draw", "Erase", "Add thought", "Add media", "Undo", "Redo"):
            self.assertIn(token, combined)
        self.assertIn("hover and keyboard focus", combined)
        self.assertIn("Connect nodes", combined)
        self.assertIn("Size & position", combined)

    def test_active_doc_guard_rejects_every_legacy_runtime_variant(self) -> None:
        forbidden_variants = (
            "POST /creative/start",
            "The /creative router remains registered.",
            "Guided sessions remain available.",
            "Guided workspaces remain available.",
            "Open the guided-session archive.",
            "Browse the saved-session archive.",
            "Browse the saved session archive.",
            "Return to the legacy workspace.",
            "Open the legacy page.",
            "Open the legacy session archive.",
            "Legacy session recovery restores the draft.",
            "Legacy-session recovery restores the draft.",
        )
        for variant in forbidden_variants:
            with self.subTest(variant=variant):
                self.assertTrue(forbidden_active_doc_matches(variant))

    def test_active_doc_guard_allows_historical_supabase_row_retention(self) -> None:
        allowed_retention = (
            "The historical creative_sessions rows are retained; no runtime route reads or mutates them.",
            "Migration 20260718100737_create_creative_sessions.sql remains historical.",
        )
        for statement in allowed_retention:
            with self.subTest(statement=statement):
                self.assertEqual(forbidden_active_doc_matches(statement), ())

    def test_old_fixed_workflow_is_not_described_as_primary(self) -> None:
        active = "\n".join(self.read(path) for path in (
            "PRODUCT.md", "README.md", "docs/README.md", "docs/CLIENT_FLOW.md",
        ))
        for stale in (
            "Creative Curator is a guided creative-review workspace",
            "The authenticated Guided Workspace is available at `/`",
            "Current product is root `/` Guided Workspace",
        ):
            self.assertNotIn(stale, active)

    def test_readme_names_only_production_routes(self) -> None:
        readme = self.read("README.md")
        self.assertNotIn("`/studio`", readme)
        self.assertNotIn("`/projects/legacy/", readme)
        self.assertIn("Brand Constellation is the sole production journey", readme)

    def test_api_contract_lists_every_project_route_without_legacy_runtime(self) -> None:
        api = self.read("docs/API.md")
        required = (
            "GET /projects/summaries",
            "GET /projects/{project_id}/summary",
            "POST /projects/{project_id}/proposals/{proposal_id}/reject",
            "GET /projects/{project_id}/challenges/{node_id}/resolutions",
            "PATCH /projects/{project_id}/edges/{edge_id}",
            "DELETE /projects/{project_id}/edges/{edge_id}",
            "POST /projects/{project_id}/nodes/{node_id}/approve",
        )
        for route in required:
            with self.subTest(route=route):
                self.assertIn(route, api)
        for token in ("Idempotency-Key", "25 records", "64 KiB", "UTF-8", "held terminal"):
            self.assertIn(token, api)
        self.assertNotIn("/creative/", api)

    def test_api_inventory_and_request_models_match_openapi(self) -> None:
        api = self.read("docs/API.md")
        inventory_match = re.search(
            r"## Canonical project HTTP inventory.*?```text\n(.*?)\n```",
            api,
            re.DOTALL,
        )
        self.assertIsNotNone(inventory_match)
        documented_routes = {
            tuple(line.split(" ", 1))
            for line in inventory_match.group(1).splitlines()
            if line.strip()
        }

        openapi = app.openapi()
        methods = {"get", "post", "put", "patch", "delete"}
        actual_routes = {
            (method.upper(), path)
            for path, operations in openapi["paths"].items()
            if path.startswith("/projects") or path == "/users/me/theme"
            for method in operations
            if method in methods
        }
        self.assertEqual(documented_routes, actual_routes)

        matrix_match = re.search(
            r"### Route/status/shape matrix.*?\| Method/path \| Input \| Success \|\n"
            r"\| --- \| --- \| --- \|\n(.*?)(?:\n\n|\Z)",
            api,
            re.DOTALL,
        )
        self.assertIsNotNone(matrix_match)
        documented_inputs: dict[tuple[str, str], str] = {}
        for line in matrix_match.group(1).splitlines():
            row = re.match(r"\| `([A-Z]+) ([^`]+)` \| (.*?) \|", line)
            if row:
                documented_inputs[(row.group(1), row.group(2))] = row.group(3)
        self.assertEqual(set(documented_inputs), actual_routes)

        for method, path in actual_routes:
            operation = openapi["paths"][path][method.lower()]
            schema = (
                operation.get("requestBody", {})
                .get("content", {})
                .get("application/json", {})
                .get("schema", {})
            )
            reference = schema.get("$ref")
            if reference is None:
                continue
            model = reference.rsplit("/", 1)[-1]
            with self.subTest(method=method, path=path, model=model):
                self.assertIn(f"`{model}`", documented_inputs[(method, path)])

    def test_api_matrix_documents_strict_project_models_and_statuses(self) -> None:
        api = self.read("docs/API.md")
        source = self.read("backend/app/api/projects.py")
        for model in (
            "ProjectCreate", "NodeCreate", "NodeUpdate", "EdgeCreate", "EdgeUpdate",
            "EdgeDelete", "LayoutRequest", "AnnotationsRequest", "ThemeRequest",
            "AnalysisRequest", "ProjectVersionRequest", "BlueprintCompileRequest",
            "BranchCandidate", "BranchPromotionRequest", "ChallengeResolutionRequest",
        ):
            self.assertIn(f"class {model}", source)
            self.assertIn(f"`{model}`", api)
        for token in (
            "strict; unknown fields rejected", "default `50`; range `1..100`",
            "`expected_project_version`: integer `>= 0` when present", "DELETE request body",
            "`201`", "`204`", "`413`", "`415`", "`422`", "`503`",
            "10,000", "50,000", "8 MiB", "5 MiB", "max 500",
        ):
            self.assertIn(token, api)

    def test_versioning_contract_is_route_specific_about_decision_approval(self) -> None:
        api = self.read("docs/API.md")
        self.assertIn(
            "Decision approval is the exception: `VersionRequest.expected_node_version` only",
            api,
        )
        self.assertIn("atomically advances the current project version", api)
        self.assertIn("Proposal rejection accepts no version body", api)
        self.assertIn("Global theme writes update the authenticated user preference only", api)
        for false_blanket in (
            "Semantic writes carry expected project and record versions",
            "Every semantic node or relationship mutation compares record and project versions",
            "Semantic requests carry `expected_project_version`; record changes also carry node or edge version",
        ):
            self.assertNotIn(false_blanket, api)

    def test_supabase_contract_names_graph_migration_rollback_and_guards(self) -> None:
        docs = self.read("docs/SUPABASE.md")
        for token in (
            "20260726090000_add_spatial_brand_projects.sql",
            "rollback_spatial_brand_projects.sql",
            "brand_projects",
            "accept_brand_proposal",
            "commit_brand_idempotent_mutation",
            "SUPABASE_LOCAL_TEST_URL",
            "SUPABASE_LOCAL_TEST_KEY",
            "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
        ):
            self.assertIn(token, docs)
        self.assertTrue((ROOT / "supabase/migrations/20260726090000_add_spatial_brand_projects.sql").is_file())
        self.assertTrue((ROOT / "supabase/manual/rollback_spatial_brand_projects.sql").is_file())

    def test_supabase_retains_historical_rows_without_runtime_access(self) -> None:
        contract = self.read("docs/SUPABASE.md")
        migration = self.read("supabase/migrations/20260722090000_add_auth_and_byok_settings.sql")
        self.assertIn("truncate table public.creative_sessions", migration.casefold())
        self.assertIn("truncates creative_sessions on first apply", contract)
        self.assertIn("production-removal change adds no destructive migration", contract)
        self.assertIn("post-migration historical creative_sessions rows are retained", contract)
        self.assertIn("historical creative_sessions rows are retained", contract)
        self.assertIn("no runtime route reads or mutates them", contract)
        self.assertIn("no destructive migration", contract)

    def test_root_remains_public_for_signed_in_and_signed_out_users(self) -> None:
        readme = self.read("README.md")
        client_flow = self.read("docs/CLIENT_FLOW.md")
        proxy = self.read("client/proxy.ts")
        self.assertIn('matcher: ["/settings/:path*", "/projects/:path*"]', proxy)
        self.assertIn("`/` remains public whether signed in or signed out", readme)
        self.assertIn("`/` remains public whether signed in or signed out", client_flow)
        self.assertNotIn("Unauthenticated visits to `/`,", client_flow)
        self.assertNotIn("`/` redirects authenticated users to Projects", readme)

    def test_index_links_approved_production_design_and_plan(self) -> None:
        index = self.read("docs/INDEX.md")
        self.assertIn("2026-07-27-production-workspace-toolbar-design.md", index)
        self.assertIn("2026-07-27-production-workspace-toolbar-implementation.md", index)

    def test_readme_requires_unit_gate_and_spatial_dependencies(self) -> None:
        readme = self.read("README.md")
        package = self.read("client/package.json")
        self.assertIn("npm run test:unit -- --run", readme)
        self.assertIn("npx playwright install chromium", readme)
        for dependency in ("@xyflow/react", "lucide-react", "perfect-freehand", "motion"):
            self.assertIn(dependency, readme)
            self.assertRegex(package, rf'"{re.escape(dependency)}"\s*:')

    def test_documentation_relative_links_resolve(self) -> None:
        for relative in (
            "README.md", "PRODUCT.md", "DESIGN.md", "docs/README.md",
            "docs/DEMO_TUTORIAL.md",
            "docs/CLIENT_FLOW.md", "docs/API.md", "docs/SUPABASE.md",
            "docs/DEVLOG.md", "docs/CHANGELOG.md", "docs/INDEX.md",
            "docs/COMPONENT_PROVENANCE.md",
        ):
            source = ROOT / relative
            text = source.read_text(encoding="utf-8")
            for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
                if target.startswith(("http://", "https://", "#")):
                    continue
                path = target.split("#", 1)[0]
                if not path:
                    continue
                with self.subTest(source=relative, target=target):
                    self.assertTrue((source.parent / path).resolve().exists())


if __name__ == "__main__":
    unittest.main()
