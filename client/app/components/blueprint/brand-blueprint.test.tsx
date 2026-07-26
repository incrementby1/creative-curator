import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlueprintSnapshot } from "../../lib/project-types";
import { BrandBlueprint } from "./brand-blueprint";

afterEach(cleanup);

const section = (entries: readonly Readonly<Record<string, string>>[] = [], ready = true) => ({
  ready, source_node_ids: entries.map((entry) => entry.id),
  decision_ids: entries.filter((entry) => entry.type === "decision").map((entry) => entry.id),
  evidence_ids: entries.filter((entry) => entry.type === "evidence").map((entry) => entry.id),
  assumption_ids: entries.filter((entry) => entry.type === "assumption").map((entry) => entry.id),
  challenge_ids: entries.filter((entry) => entry.type === "challenge").map((entry) => entry.id),
  blocking_challenge_ids: entries.filter((entry) => entry.type === "challenge").map((entry) => entry.id), entries,
});

const snapshot: BlueprintSnapshot = {
  id: "snap-2", project_id: "project-1", name: "Starter Brand Blueprint 2", node_ids: ["purpose-1", "evidence-1", "assumption-1", "challenge-1"], edge_ids: [],
  version: 1, project_version: 8, sequence: 2, created_at: "2026-07-27T08:30:00Z",
  readiness_warnings: ["naming: approved decision required"], unresolved_assumption_ids: ["assumption-1"],
  sections: {
    purpose: section([{ id: "purpose-1", title: "Make complex moves feel calm", content: "Northline creates clarity under pressure.", type: "decision", rationale: "Repeated customer interviews favor calm direction." }]),
    audience: section(), positioning: section(), promise: section(), "personality-voice": section(), naming: section([], false), messaging: section(), "visual-direction": section(),
    "evidence-assumptions": section([
      { id: "evidence-1", title: "Observed behavior", content: "Customers ask for one clear next step.", type: "evidence", rationale: "Five interviews." },
      { id: "assumption-1", title: "Calm earns trust", content: "Still needs validation.", type: "assumption", rationale: "Founder hypothesis." },
    ]),
    "unresolved-challenges": section([{ id: "challenge-1", title: "Proof gap", content: "No conversion evidence yet.", type: "challenge", rationale: "Hermes found unsupported promise." }], false),
    "next-actions": section(),
  },
};

describe("BrandBlueprint", () => {
  it("renders every canonical MVP section, dated version metadata, and explicit early warnings", () => {
    render(<BrandBlueprint currentProjectVersion={9} onExport={vi.fn()} projectTitle="Northline" snapshot={snapshot} />);
    for (const name of ["Brand idea & purpose", "Target audience & central tension", "Positioning & differentiation", "Brand promise", "Personality & voice", "Naming territory & shortlist", "Messaging pillars & sample tagline", "Visual direction", "Evidence & assumptions", "Unresolved Hermes challenges", "Recommended next actions"]) {
      expect(screen.getByRole("heading", { name })).toBeVisible();
    }
    expect(screen.getByText("Snapshot 02")).toBeVisible();
    expect(screen.getByText("Graph version 8")).toBeVisible();
    expect(screen.getByText("July 27, 2026")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Early Blueprint");
    expect(screen.getByRole("status")).toHaveTextContent("newer than this immutable snapshot");
  });

  it("keeps evidence, assumptions, challenges, sources, and rationale explicit without hover", async () => {
    const user = userEvent.setup();
    render(<BrandBlueprint currentProjectVersion={8} onExport={vi.fn()} projectTitle="Northline" snapshot={snapshot} />);
    const evidence = screen.getByRole("article", { name: "Observed behavior" });
    const assumption = screen.getByRole("article", { name: "Calm earns trust" });
    expect(within(evidence).getByText("Evidence")).toBeVisible();
    expect(within(assumption).getByText("Assumption")).toBeVisible();
    expect(screen.getByRole("article", { name: "Proof gap" })).toHaveTextContent("Unresolved challenge");
    const source = within(assumption).getByRole("link", { name: "Open source node" });
    expect(source).toHaveAttribute("href", "/projects/project-1?node=assumption-1");
    const rationale = within(assumption).getByText("Rationale").closest("details")!;
    expect(rationale).not.toHaveAttribute("open");
    await user.click(within(assumption).getByText("Rationale"));
    expect(rationale).toHaveAttribute("open");
    expect(within(assumption).getByText("Founder hypothesis.")).toBeVisible();
  });

  it("uses explicit print export and marks semantic chrome for print removal", async () => {
    const user = userEvent.setup(); const onExport = vi.fn();
    const { container } = render(<BrandBlueprint currentProjectVersion={8} onExport={onExport} projectTitle="Northline" snapshot={snapshot} />);
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("[data-print-hidden=true]").length).toBeGreaterThan(0);
    expect(container.querySelector("article[data-blueprint-document=true]")).not.toBeNull();
  });
});
