import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GraphEdge, GraphNode } from "../../lib/project-types";
import { AccessibleGraph } from "./accessible-graph";
import { MobileGraphNavigator } from "./mobile-graph-navigator";

const now = "2026-07-27T00:00:00Z";
const nodes: GraphNode[] = [
  { id: "00000000-0000-4000-8000-000000000001", project_id: "10000000-0000-4000-8000-000000000001", node_type: "evidence", title: "Known fact", content: "Observed", state: "working", created_by: "user", provenance: null, tags: [], version: 1, created_at: now, updated_at: now },
  { id: "00000000-0000-4000-8000-000000000002", project_id: "10000000-0000-4000-8000-000000000001", node_type: "assumption", title: "Assumption", content: "Untested", state: "working", created_by: "user", provenance: null, tags: [], version: 1, created_at: now, updated_at: now },
];
const edges: GraphEdge[] = [{ id: "20000000-0000-4000-8000-000000000001", project_id: nodes[0].project_id, source_node_id: nodes[0].id, target_node_id: nodes[1].id, edge_type: "supports", label: null, version: 1, created_at: now, updated_at: now }];

describe("accessible constellation representations", () => {
  it("focuses preselected structured node on active mount", () => {
    const view = render(<AccessibleGraph active edges={edges} nodes={nodes} selectedNodeId={nodes[0].id} onConnect={vi.fn()} onCreate={vi.fn()} onMove={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Select Known fact" })).toHaveFocus();
    view.unmount();
  });

  it("announces and focuses mobile traversal destination", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [selected, setSelected] = useState(nodes[0].id);
      return <MobileGraphNavigator edges={edges} nodes={nodes} selectedNodeId={selected} onSelect={setSelected} />;
    }
    const view = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Next node" }));
    expect(screen.getByRole("heading", { name: "Assumption" })).toHaveFocus();
    expect(screen.getByRole("status", { name: "Mobile graph announcements" })).toHaveTextContent("Focused Assumption. Type Assumption. Node 2 of 2. 1 neighboring relationship.");
    view.unmount();
  });

  it("reactivates focus and live content for same-node overview and one-node traversal", async () => {
    const user = userEvent.setup();
    render(<MobileGraphNavigator edges={[]} nodes={nodes.slice(0, 1)} selectedNodeId={nodes[0].id} onSelect={vi.fn()} />);
    const live = screen.getByRole("status", { name: "Mobile graph announcements" });
    const overview = screen.getByRole("button", { name: "Focus Known fact" });
    await user.click(overview);
    expect(screen.getByRole("heading", { name: "Known fact" })).toHaveFocus();
    const firstMessage = live.firstElementChild;
    await user.click(screen.getByRole("button", { name: "Next node" }));
    expect(screen.getByRole("heading", { name: "Known fact" })).toHaveFocus();
    expect(live.firstElementChild).not.toBe(firstMessage);
    const secondMessage = live.firstElementChild;
    await user.click(screen.getByRole("button", { name: "Previous node" }));
    expect(screen.getByRole("heading", { name: "Known fact" })).toHaveFocus();
    expect(live.firstElementChild).not.toBe(secondMessage);
    expect(live).toHaveTextContent("Focused Known fact. Type Evidence. Node 1 of 1. 0 neighboring relationships.");
  });
});
