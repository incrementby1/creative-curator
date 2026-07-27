import type { Node } from "@xyflow/react";

import type { GraphNode, ListedProposal } from "../../lib/project-types";

const PREVIEW_WIDTH = 244;
const PREVIEW_HEIGHT = 124;
const PREVIEW_GAP = 40;

type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>;

function dimension(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nodeBox(node: Node): Box {
  const width = dimension(node.style?.width ?? node.measured?.width, PREVIEW_WIDTH);
  const height = dimension(node.style?.height ?? node.measured?.height, PREVIEW_HEIGHT);
  return { left: node.position.x, top: node.position.y, right: node.position.x + width, bottom: node.position.y + height };
}

function overlaps(candidate: Box, occupied: readonly Box[]): boolean {
  return occupied.some((box) => candidate.left < box.right + PREVIEW_GAP
    && candidate.right + PREVIEW_GAP > box.left
    && candidate.top < box.bottom + PREVIEW_GAP
    && candidate.bottom + PREVIEW_GAP > box.top);
}

function positionNear(anchor: Box, occupied: readonly Box[], index: number): { x: number; y: number } {
  const verticalStep = PREVIEW_HEIGHT + PREVIEW_GAP;
  const horizontalStep = PREVIEW_WIDTH + PREVIEW_GAP;
  const alignedX = Math.max(0, Math.min(anchor.left, anchor.right - PREVIEW_WIDTH));
  const candidates = [
    { x: alignedX, y: anchor.bottom + PREVIEW_GAP + index * verticalStep },
    { x: alignedX, y: anchor.top - PREVIEW_GAP - PREVIEW_HEIGHT - index * verticalStep },
    { x: anchor.right + PREVIEW_GAP, y: anchor.top + index * verticalStep },
    { x: anchor.left - horizontalStep, y: anchor.top + index * verticalStep },
  ];
  return candidates.find(({ x, y }) => x >= 0 && y >= 0 && !overlaps({ left: x, top: y, right: x + PREVIEW_WIDTH, bottom: y + PREVIEW_HEIGHT }, occupied))
    ?? { x: alignedX, y: Math.max(anchor.bottom, ...occupied.map((box) => box.bottom)) + PREVIEW_GAP + index * verticalStep };
}

export function createProposalPreviewNodes(projectId: string, proposals: readonly ListedProposal[], canvasNodes: readonly Node[]): Node[] {
  const canvasById = new Map(canvasNodes.map((node) => [node.id, node]));
  const occupied = canvasNodes.map(nodeBox);
  const fallbackAnchor: Box = occupied.length > 0
    ? { left: occupied[0].left, right: occupied[0].right, top: Math.min(...occupied.map((box) => box.top)), bottom: Math.max(...occupied.map((box) => box.bottom)) }
    : { left: 80, right: 80 + PREVIEW_WIDTH, top: 80, bottom: 80 + PREVIEW_HEIGHT };
  const previews: Node[] = [];

  for (const proposal of proposals) {
    const anchorNode = [...proposal.target_node_ids, ...proposal.candidate.affected_node_ids]
      .map((id) => canvasById.get(id))
      .find((node): node is Node => Boolean(node));
    const anchor = anchorNode ? nodeBox(anchorNode) : fallbackAnchor;
    proposal.candidate.proposed_nodes.forEach((item, index) => {
      const position = positionNear(anchor, occupied, index);
      const preview: Node = {
        id: `preview:${proposal.id}:${item.client_key}`,
        type: "brand",
        draggable: false,
        selectable: false,
        position,
        data: {
          preview: true,
          record: {
            id: `preview:${item.client_key}`,
            project_id: projectId,
            node_type: item.node_type,
            title: item.title,
            content: item.content,
            state: "working",
            created_by: "hermes",
            provenance: item.rationale,
            tags: [],
            version: 0,
            created_at: "",
            updated_at: "",
          } as GraphNode,
        },
        style: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
      };
      previews.push(preview);
      occupied.push(nodeBox(preview));
    });
  }
  return previews;
}
