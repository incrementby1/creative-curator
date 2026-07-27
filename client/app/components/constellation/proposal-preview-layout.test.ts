import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { GraphNode, ListedProposal } from "../../lib/project-types";
import { createProposalPreviewNodes } from "./proposal-preview-layout";

const record = (id: string, title: string): GraphNode => ({
  id,
  project_id: "project-1",
  node_type: "assumption",
  title,
  content: `${title} details`,
  state: "working",
  created_by: "user",
  provenance: null,
  tags: [],
  version: 1,
  created_at: "2026-07-27T00:00:00Z",
  updated_at: "2026-07-27T00:00:00Z",
});

const proposal: ListedProposal = {
  id: "proposal-1",
  project_id: "project-1",
  title: "Challenge assumption",
  rationale: "Claim needs proof",
  target_node_ids: ["assumption-1"],
  canonical_hash: "hash",
  dependency_node_versions: [["assumption-1", 1]],
  dependency_edge_versions: [],
  creation_source: "hermes",
  state: "pending",
  version: 1,
  created_at: "2026-07-27T00:00:00Z",
  updated_at: "2026-07-27T00:00:00Z",
  candidate: {
    summary: "Add challenges",
    affected_node_ids: ["assumption-1"],
    proposed_nodes: [
      { client_key: "challenge-1", node_type: "challenge", title: "Test the assumption", content: "Find direct evidence", rationale: "Validate claim" },
      { client_key: "challenge-2", node_type: "evidence", title: "Collect proof", content: "Interview customers", rationale: "Resolve challenge" },
    ],
    proposed_edges: [],
  },
};

const occupied: Node[] = [
  { id: "fact-1", type: "brand", position: { x: 80, y: 80 }, data: { record: record("fact-1", "Known fact") }, style: { width: 244, height: 124 } },
  { id: "assumption-1", type: "brand", position: { x: 372, y: 80 }, data: { record: record("assumption-1", "Assumption") }, style: { width: 244, height: 124 } },
];

const rectangle = (node: Node) => ({
  left: node.position.x,
  top: node.position.y,
  right: node.position.x + Number(node.style?.width ?? 244),
  bottom: node.position.y + Number(node.style?.height ?? 124),
});

const intersects = (left: Node, right: Node) => {
  const a = rectangle(left);
  const b = rectangle(right);
  return Math.min(a.right, b.right) > Math.max(a.left, b.left)
    && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
};

describe("proposal preview layout", () => {
  it("places proposal nodes near their target without covering graph work", () => {
    const previews = createProposalPreviewNodes("project-1", [proposal], occupied);

    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview.draggable).toBe(false);
      expect(preview.selectable).toBe(false);
      expect(preview.data.preview).toBe(true);
      expect(occupied.some((node) => intersects(preview, node))).toBe(false);
    }
    expect(intersects(previews[0], previews[1])).toBe(false);
    expect(previews[0].position.x).toBe(occupied[1].position.x);
    expect(previews[0].position.y).toBeGreaterThan(occupied[1].position.y + 124);
  });
});
