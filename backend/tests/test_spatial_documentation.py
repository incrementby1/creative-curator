from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class SpatialDocumentationContractTests(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_product_and_docs_index_name_constellation_as_primary(self) -> None:
        product = self.read("PRODUCT.md")
        index = self.read("docs/README.md")
        self.assertIn("Brand Constellation is the primary workspace", product)
        self.assertIn("Primary product: Brand Constellation", index)
        self.assertNotIn("Current product is root `/` Guided Workspace", index)

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

    def test_readme_distinguishes_mutable_studio_from_read_only_archive(self) -> None:
        readme = self.read("README.md")
        shell = self.read("client/app/components/creative-shell.tsx")
        archive = self.read("client/app/components/projects/legacy-session.tsx")
        self.assertIn("`/studio` remains the mutable legacy Guided Workspace", readme)
        self.assertIn("`/projects/legacy/[sessionId]` is its read-only archive view", readme)
        self.assertIn('href="/studio"', shell)
        self.assertIn("Read-only legacy session", archive)

    def test_api_contract_lists_every_project_and_legacy_route(self) -> None:
        api = self.read("docs/API.md")
        required = (
            "GET /projects/summaries",
            "GET /projects/{project_id}/summary",
            "POST /projects/{project_id}/proposals/{proposal_id}/reject",
            "GET /projects/{project_id}/challenges/{node_id}/resolutions",
            "PATCH /projects/{project_id}/edges/{edge_id}",
            "DELETE /projects/{project_id}/edges/{edge_id}",
            "POST /projects/{project_id}/nodes/{node_id}/approve",
            "GET /creative/sessions",
            "GET /creative/sessions/{session_id}",
        )
        for route in required:
            with self.subTest(route=route):
                self.assertIn(route, api)
        for token in ("Idempotency-Key", "25 records", "64 KiB", "UTF-8", "held terminal"):
            self.assertIn(token, api)

    def test_api_matrix_documents_strict_project_models_and_statuses(self) -> None:
        api = self.read("docs/API.md")
        source = self.read("backend/app/api/projects.py")
        for model in (
            "ProjectCreate", "NodeCreate", "NodeUpdate", "EdgeCreate", "EdgeUpdate",
            "EdgeDelete", "LayoutRequest", "AnnotationsRequest", "ThemeRequest",
            "AnalysisRequest", "ProjectVersionRequest", "ChallengeResolutionRequest",
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
            "docs/CLIENT_FLOW.md", "docs/API.md", "docs/SUPABASE.md",
            "docs/DEVLOG.md", "docs/COMPONENT_PROVENANCE.md",
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
