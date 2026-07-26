import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphEdge, GraphNode } from "../../lib/project-types";
import { ProjectMapPanel } from "./project-map-panel";
const base = { project_id: "p", node_type: "decision", content: "", state: "working", created_by: "user", provenance: null, version: 1, created_at: "", updated_at: "" } as const;
const nodes: GraphNode[] = [{ ...base, id: "a", title: "Calm", tags: ["branch:calm"] }, { ...base, id: "b", title: "Bold", tags: ["branch:bold"] }];
const richNodes: GraphNode[] = [
  { ...base, id: "i", node_type: "idea", title: "Editorial warmth", state: "working", tags: ["branch:bold"] },
  { ...base, id: "d", node_type: "decision", title: "High contrast", state: "approved", tags: ["branch:bold"] },
  { ...base, id: "e", node_type: "evidence", title: "Customer interviews", tags: ["branch:bold"] },
  { ...base, id: "a2", node_type: "assumption", title: "Premium signals trust", tags: ["branch:calm"] },
  { ...base, id: "c", node_type: "challenge", title: "Contrast may alienate", tags: ["branch:bold"] },
];
const edges: GraphEdge[] = [{ id: "edge", project_id: "p", source_node_id: "e", target_node_id: "d", edge_type: "supports", label: null, version: 1, created_at: "", updated_at: "" }];
afterEach(cleanup);
describe("ProjectMapPanel branches", () => { it("compares and promotes a chosen semantic branch", async () => { const user = userEvent.setup(); const promote = vi.fn(); render(<ProjectMapPanel activeTypes={new Set(["decision"])} branches={["bold", "calm"]} clusters={[]} nodes={nodes} unresolvedOnly={false} onFitSelection={() => undefined} onPromote={promote} onType={() => undefined} onUnresolved={() => undefined} />); await user.click(screen.getByLabelText("Compare bold")); await user.click(screen.getByLabelText("Compare calm")); expect(screen.getByText("Bold: 1 node")).toBeVisible(); expect(screen.getByText("Calm: 1 node")).toBeVisible(); await user.click(screen.getByRole("button", { name: "Promote bold decisions" })); expect(promote).toHaveBeenCalledWith("bold"); }); });

it("groups semantic branch content and relationships for accessible comparison", async () => {
  const user = userEvent.setup();
  render(<ProjectMapPanel activeTypes={new Set(["decision"])} branches={["bold", "calm"]} clusters={[]} edges={edges} nodes={richNodes} unresolvedOnly={false} onFitSelection={() => undefined} onType={() => undefined} onUnresolved={() => undefined} />);
  await user.click(screen.getByLabelText("Compare bold")); await user.click(screen.getByLabelText("Compare calm"));
  const comparison = screen.getByRole("region", { name: "Branch comparison" });
  expect(within(comparison).getByText("Editorial warmth — Working")).toBeVisible();
  expect(within(comparison).getByText("High contrast — Approved")).toBeVisible();
  expect(within(comparison).getByText("Customer interviews")).toBeVisible();
  expect(within(comparison).getAllByText("Premium signals trust")[0]).toBeVisible();
  expect(within(comparison).getByText("Contrast may alienate")).toBeVisible();
  expect(within(comparison).getByText("Customer interviews supports High contrast")).toBeVisible();
  expect(within(comparison).getByText(/Only Bold:/)).toBeVisible();
});
