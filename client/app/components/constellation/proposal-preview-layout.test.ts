import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { GraphNode, ListedProposal } from "../../lib/project-types";
import { createProposalPreviewEdges, createProposalPreviewNodes } from "./proposal-preview-layout";

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

const bounds = { left: 0, top: 0, right: 900, bottom: 680 };
const dimensions = {
  "proposal-1:challenge-1": { width: 244, height: 124 },
  "proposal-1:challenge-2": { width: 244, height: 124 },
};

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
    const previews = createProposalPreviewNodes("project-1", [proposal], occupied, { bounds, dimensions });

    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview.draggable).toBe(false);
      expect(preview.selectable).toBe(false);
      expect(preview.connectable).toBe(false);
      expect(preview.focusable).toBe(false);
      expect(preview.ariaLabel).toContain("Proposal preview");
      expect(preview.ariaLabel).toContain("not approved");
      expect(preview.data.preview).toBe(true);
      expect(occupied.some((node) => intersects(preview, node))).toBe(false);
    }
    expect(intersects(previews[0], previews[1])).toBe(false);
    expect(previews[0].position.x).toBe(occupied[1].position.x);
    expect(previews[0].position.y).toBeGreaterThan(occupied[1].position.y + 124);
  });

  it("contains a measured long preview when its target is at the canvas edge", () => {
    const edgeTarget: Node = {
      id: "assumption-1",
      type: "brand",
      position: { x: 660, y: 500 },
      data: { record: record("assumption-1", "Edge assumption") },
      style: { width: 220, height: 140 },
    };
    const edgeBounds = { left: 100, top: 120, right: 900, bottom: 700 };
    const previews = createProposalPreviewNodes("project-1", [proposal], [edgeTarget], {
      bounds: edgeBounds,
      dimensions: {
        "proposal-1:challenge-1": { width: 280, height: 220 },
        "proposal-1:challenge-2": { width: 252, height: 176 },
      },
    });

    for (const preview of previews) {
      const box = rectangle(preview);
      expect(box.left).toBeGreaterThanOrEqual(edgeBounds.left);
      expect(box.top).toBeGreaterThanOrEqual(edgeBounds.top);
      expect(box.right).toBeLessThanOrEqual(edgeBounds.right);
      expect(box.bottom).toBeLessThanOrEqual(edgeBounds.bottom);
      expect(intersects(preview, edgeTarget)).toBe(false);
    }
    expect(previews[0].style).toMatchObject({ width: 280, height: 220 });
  });

  it("packs multiple variable-size proposal previews without collisions", () => {
    const secondProposal: ListedProposal = {
      ...proposal,
      id: "proposal-2",
      target_node_ids: ["fact-1"],
      candidate: {
        ...proposal.candidate,
        proposed_nodes: [{ client_key: "proof", node_type: "evidence", title: "Long customer proof", content: "Detailed evidence ".repeat(30), rationale: "Resolve the open claim" }],
      },
    };
    const previews = createProposalPreviewNodes("project-1", [proposal, secondProposal], occupied, {
      bounds,
      dimensions: {
        ...dimensions,
        "proposal-1:challenge-1": { width: 268, height: 196 },
        "proposal-1:challenge-2": { width: 232, height: 152 },
        "proposal-2:proof": { width: 280, height: 240 },
      },
    });

    expect(previews).toHaveLength(3);
    previews.forEach((preview, index) => {
      const box = rectangle(preview);
      expect(box.left).toBeGreaterThanOrEqual(bounds.left);
      expect(box.top).toBeGreaterThanOrEqual(bounds.top);
      expect(box.right).toBeLessThanOrEqual(bounds.right);
      expect(box.bottom).toBeLessThanOrEqual(bounds.bottom);
      expect(occupied.some((node) => intersects(preview, node))).toBe(false);
      expect(previews.slice(index + 1).some((node) => intersects(preview, node))).toBe(false);
    });
  });

  it("hides canvas previews when no collision-free bounded slot exists", () => {
    const saturatedBounds = { left: 0, top: 0, right: 300, bottom: 200 };
    const saturatedNode: Node = {
      id: "assumption-1", type: "brand", position: { x: 0, y: 0 }, data: { record: record("assumption-1", "Saturated") }, style: { width: 300, height: 200 },
    };
    const previews = createProposalPreviewNodes("project-1", [proposal], [saturatedNode], {
      bounds: saturatedBounds,
      dimensions: {
        "proposal-1:challenge-1": { width: 220, height: 124 },
        "proposal-1:challenge-2": { width: 220, height: 124 },
      },
    });

    expect(previews).toHaveLength(2);
    expect(previews.every((preview) => preview.hidden)).toBe(true);
    expect(createProposalPreviewEdges([proposal], previews)).toEqual([]);
  });

  it("keeps bounded packing work subquadratic with 250 nodes and multiple previews", () => {
    const denseNodes = Array.from({ length: 250 }, (_, index): Node => ({
      id: index === 0 ? "assumption-1" : `dense-${index}`,
      type: "brand",
      position: { x: (index % 25) * 104, y: Math.floor(index / 25) * 84 },
      data: { record: record(`dense-${index}`, `Dense ${index}`) },
      style: { width: 64, height: 44 },
    }));
    const manyProposal = {
      ...proposal,
      candidate: {
        ...proposal.candidate,
        proposed_nodes: Array.from({ length: 8 }, (_, index) => ({
          client_key: `candidate-${index}`, node_type: "challenge" as const, title: `Candidate ${index}`, content: "Bounded work", rationale: "Review",
        })),
      },
    };
    const metrics = { candidates: 0, collisionChecks: 0 };
    const started = performance.now();
    const previews = createProposalPreviewNodes("project-1", [manyProposal], denseNodes, {
      bounds: { left: 0, top: 0, right: 2600, bottom: 1200 },
      dimensions: Object.fromEntries(manyProposal.candidate.proposed_nodes.map((item) => [`proposal-1:${item.client_key}`, { width: 220, height: 124 }])),
      metrics,
    });

    expect(previews).toHaveLength(8);
    expect(metrics.candidates).toBeGreaterThan(0);
    expect(metrics.collisionChecks).toBeGreaterThan(0);
    expect(metrics.candidates).toBeLessThan(10_000);
    expect(metrics.collisionChecks).toBeLessThan(50_000);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("repacks from the current visible node geometry after a live mutation", () => {
    const initial = createProposalPreviewNodes("project-1", [proposal], occupied, { bounds, dimensions });
    const moved = occupied.map((node) => node.id === "assumption-1" ? { ...node, position: { x: 80, y: 380 } } : node);
    const repacked = createProposalPreviewNodes("project-1", [proposal], moved, { bounds, dimensions });

    expect(repacked[0].position).not.toEqual(initial[0].position);
    expect(moved.some((node) => intersects(repacked[0], node))).toBe(false);
  });

  it("creates inert truthful edges only when both endpoints render", () => {
    const previews = createProposalPreviewNodes("project-1", [proposal], occupied, { bounds, dimensions });
    const connected = { ...proposal, candidate: { ...proposal.candidate, proposed_edges: [{ source_key: "challenge-1", target_key: "assumption-1", edge_type: "supports" as const }] } };
    const edges = createProposalPreviewEdges([connected], previews);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ focusable: false, selectable: false });
    expect(edges[0].ariaLabel).toContain("Proposal preview relationship");
    expect(edges[0].ariaLabel).toContain("not approved");
  });
});
