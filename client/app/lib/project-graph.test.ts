import { describe, expect, it } from "vitest";

import {
  acceptProposalPreview,
  acceptProposalResult,
  createGraphState,
  quickCapture,
  previewProposal,
  redoSemantic,
  rejectProposalPreview,
  setLayoutPosition,
  setSelection,
  undoSemantic,
} from "./project-graph";
import type { GraphNode, ProposalWithCandidate } from "./project-types";

const node: GraphNode = {
  id: "node-1", project_id: "project-1", node_type: "idea", title: "Start",
  content: "Original", state: "working", created_by: "user", provenance: null,
  tags: [], version: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

const proposal: ProposalWithCandidate = {
  proposal: {
    id: "proposal-1", project_id: "project-1", title: "Challenge", rationale: "Test claim",
    target_node_ids: ["node-1"], canonical_hash: "a".repeat(64),
    dependency_node_versions: [["node-1", 1]], dependency_edge_versions: [],
    creation_source: "hermes", state: "pending", version: 1,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  },
  candidate: {
    summary: "Challenge", affected_node_ids: ["node-1"], proposed_edges: [],
    proposed_nodes: [{ client_key: "new-challenge", node_type: "challenge", title: "Prove it",
      content: "Evidence missing", rationale: "Weak support" }],
  },
};

describe("project graph state", () => {
  it("quick-captures immutably and supports bounded semantic undo/redo", () => {
    const original = createGraphState([node], [], { historyLimit: 2 });
    const captured = quickCapture(original, {
      id: "node-2", project_id: "project-1", node_type: "evidence", title: "Interview",
      content: "Customer quote", state: "working", created_by: "user", provenance: "interview",
      tags: [], version: 1, created_at: node.created_at, updated_at: node.updated_at,
    });
    expect(original.semantic.nodes).toHaveLength(1);
    expect(captured.semantic.nodes).toHaveLength(2);
    expect(undoSemantic(captured).semantic.nodes).toEqual([node]);
    expect(redoSemantic(undoSemantic(captured)).semantic.nodes).toHaveLength(2);
  });

  it("previews then accepts or rejects proposal without mutating base graph", () => {
    const graph = createGraphState([node], []);
    const previewed = previewProposal(graph, proposal);
    expect(previewed.preview?.nodes).toHaveLength(1);
    expect(previewed.preview?.nodes[0].preview).toBe(true);
    expect(graph.semantic.nodes).toEqual([node]);
    const rejected = rejectProposalPreview(previewed);
    expect(rejected.preview).toBeNull();
    expect(rejected.semantic).toBe(previewed.semantic);
    expect(rejected.history).toBe(previewed.history);
    const accepted = acceptProposalPreview(previewed, [{ ...node, id: "server-node" }], []);
    expect(accepted.semantic.nodes.at(-1)?.id).toBe("server-node");
    expect(accepted.preview).toBeNull();
  });

  it("validates preview references and reconciles repeated acceptance by server ID", () => {
    const graph = createGraphState([node], [{
      id: "edge-1", project_id: "project-1", source_node_id: "node-1", target_node_id: "old",
      edge_type: "supports", label: null, version: 1, created_at: node.created_at, updated_at: node.updated_at,
    }]);
    const serverNode = { ...node, title: "Server", version: 2 };
    const serverEdge = { ...graph.semantic.edges[0], label: "updated", version: 2 };
    const once = acceptProposalResult(graph, { proposal: { ...proposal.proposal, state: "accepted" }, nodes: [serverNode], edges: [serverEdge] });
    const twice = acceptProposalResult(once, { proposal: { ...proposal.proposal, state: "accepted" }, nodes: [serverNode], edges: [serverEdge] });
    expect(twice.semantic.nodes).toEqual([serverNode]);
    expect(twice.semantic.edges).toEqual([serverEdge]);
    expect(() => previewProposal(graph, { ...proposal, candidate: { ...proposal.candidate,
      proposed_edges: [{ source_key: "missing", target_key: "node-1", edge_type: "supports" }] } })).toThrow("unknown node");
  });

  it("separates semantic, layout, selection, and viewport slices", () => {
    const graph = createGraphState([node], []);
    const laidOut = setLayoutPosition(graph, "node-1", { x: 12, y: 34 });
    const selected = setSelection(laidOut, ["node-1"], []);
    expect(laidOut.semantic).toBe(graph.semantic);
    expect(selected.semantic).toBe(graph.semantic);
    expect(selected.layout.positions["node-1"]).toEqual({ x: 12, y: 34 });
    expect(selected.ui.selectedNodeIds).toEqual(["node-1"]);
  });

  it("bounds semantic history", () => {
    let graph = createGraphState([node], [], { historyLimit: 2 });
    for (let index = 0; index < 4; index += 1) graph = quickCapture(graph, { ...node, id: `new-${index}` });
    expect(graph.history.past).toHaveLength(2);
  });
});
