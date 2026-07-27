import type { Node } from "@xyflow/react";

import type { GraphNode, ListedProposal, ProposedNode } from "../../lib/project-types";

const DEFAULT_PREVIEW_WIDTH = 244;
const DEFAULT_PREVIEW_HEIGHT = 124;
const PREVIEW_GAP = 40;
const SEARCH_STEP = 12;

export type CanvasBounds = Readonly<{ left: number; top: number; right: number; bottom: number }>;
export type PreviewDimensions = Readonly<{ width: number; height: number }>;
export type ProposalPreviewLayoutOptions = Readonly<{
  bounds: CanvasBounds;
  dimensions: Readonly<Record<string, PreviewDimensions>>;
}>;

type Box = CanvasBounds;

function dimension(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nodeBox(node: Node): Box {
  const width = dimension(node.measured?.width ?? node.style?.width, DEFAULT_PREVIEW_WIDTH);
  const height = dimension(node.measured?.height ?? node.style?.height, DEFAULT_PREVIEW_HEIGHT);
  return { left: node.position.x, top: node.position.y, right: node.position.x + width, bottom: node.position.y + height };
}

function overlaps(candidate: Box, occupied: readonly Box[]): boolean {
  return occupied.some((box) => candidate.left < box.right + PREVIEW_GAP
    && candidate.right + PREVIEW_GAP > box.left
    && candidate.top < box.bottom + PREVIEW_GAP
    && candidate.bottom + PREVIEW_GAP > box.top);
}

function contained(candidate: Box, bounds: CanvasBounds): boolean {
  return candidate.left >= bounds.left && candidate.top >= bounds.top
    && candidate.right <= bounds.right && candidate.bottom <= bounds.bottom;
}

function positionNear(anchor: Box, occupied: readonly Box[], size: PreviewDimensions, bounds: CanvasBounds): { position: { x: number; y: number }; hidden: boolean } {
  const alignedX = Math.max(bounds.left, Math.min(anchor.left, anchor.right - size.width));
  const preferred = { x: alignedX, y: anchor.bottom + PREVIEW_GAP };
  const candidates: { x: number; y: number }[] = [
    preferred,
    { x: alignedX, y: anchor.top - PREVIEW_GAP - size.height },
    { x: anchor.right + PREVIEW_GAP, y: anchor.top },
    { x: anchor.left - PREVIEW_GAP - size.width, y: anchor.top },
  ];
  const xPositions = new Set([bounds.left, bounds.right - size.width, alignedX, anchor.right + PREVIEW_GAP, anchor.left - PREVIEW_GAP - size.width]);
  const yPositions = new Set([bounds.top, bounds.bottom - size.height, preferred.y, anchor.top - PREVIEW_GAP - size.height]);
  occupied.forEach((box) => {
    xPositions.add(box.right + PREVIEW_GAP); xPositions.add(box.left - PREVIEW_GAP - size.width);
    yPositions.add(box.bottom + PREVIEW_GAP); yPositions.add(box.top - PREVIEW_GAP - size.height);
  });
  const combinations = [...xPositions].flatMap((x) => [...yPositions].map((y) => ({ x, y })))
    .sort((left, right) => Math.hypot(left.x - preferred.x, left.y - preferred.y) - Math.hypot(right.x - preferred.x, right.y - preferred.y));
  candidates.push(...combinations);
  for (let y = bounds.top; y <= bounds.bottom - size.height; y += SEARCH_STEP) {
    for (let x = bounds.left; x <= bounds.right - size.width; x += SEARCH_STEP) candidates.push({ x, y });
  }
  const seen = new Set<string>();
  const position = candidates.find(({ x, y }) => {
    const key = `${x}:${y}`; if (seen.has(key)) return false; seen.add(key);
    const candidate = { left: x, top: y, right: x + size.width, bottom: y + size.height };
    return contained(candidate, bounds) && !overlaps(candidate, occupied);
  });
  return position ? { position, hidden: false } : { position: { x: bounds.left, y: bounds.top }, hidden: true };
}

export function proposalPreviewKey(proposalId: string, clientKey: string): string {
  return `${proposalId}:${clientKey}`;
}

export function estimateProposalPreviewDimensions(item: ProposedNode, bounds: CanvasBounds): PreviewDimensions {
  const availableWidth = Math.max(1, bounds.right - bounds.left);
  const availableHeight = Math.max(1, bounds.bottom - bounds.top);
  const width = Math.min(280, availableWidth, Math.max(208, Math.min(260, availableWidth - 24)));
  const charactersPerLine = Math.max(16, Math.floor((width - 28) / 7));
  const lines = (value: string) => value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
  const estimatedHeight = 84 + lines(item.title) * 20 + lines(item.content) * 18;
  return { width, height: Math.min(280, availableHeight, Math.max(DEFAULT_PREVIEW_HEIGHT, estimatedHeight)) };
}

export function createProposalPreviewNodes(projectId: string, proposals: readonly ListedProposal[], canvasNodes: readonly Node[], options: ProposalPreviewLayoutOptions): Node[] {
  const canvasById = new Map(canvasNodes.map((node) => [node.id, node]));
  const occupied = canvasNodes.map(nodeBox);
  const fallbackAnchor: Box = occupied.length > 0
    ? { left: occupied[0].left, right: occupied[0].right, top: Math.min(...occupied.map((box) => box.top)), bottom: Math.max(...occupied.map((box) => box.bottom)) }
    : { left: options.bounds.left, right: options.bounds.left, top: options.bounds.top, bottom: options.bounds.top };
  const previews: Node[] = [];

  for (const proposal of proposals) {
    const anchorNode = [...proposal.target_node_ids, ...proposal.candidate.affected_node_ids]
      .map((id) => canvasById.get(id))
      .find((node): node is Node => Boolean(node));
    const anchor = anchorNode ? nodeBox(anchorNode) : fallbackAnchor;
    proposal.candidate.proposed_nodes.forEach((item) => {
      const requested = options.dimensions[proposalPreviewKey(proposal.id, item.client_key)] ?? { width: DEFAULT_PREVIEW_WIDTH, height: DEFAULT_PREVIEW_HEIGHT };
      const size = {
        width: Math.min(Math.max(44, dimension(requested.width, DEFAULT_PREVIEW_WIDTH)), options.bounds.right - options.bounds.left),
        height: Math.min(Math.max(44, dimension(requested.height, DEFAULT_PREVIEW_HEIGHT)), options.bounds.bottom - options.bounds.top),
      };
      const placement = positionNear(anchor, occupied, size, options.bounds);
      const preview: Node = {
        id: `preview:${proposal.id}:${item.client_key}`,
        type: "brand",
        connectable: false,
        draggable: false,
        selectable: false,
        hidden: placement.hidden,
        position: placement.position,
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
        style: size,
      };
      previews.push(preview);
      if (!preview.hidden) occupied.push(nodeBox(preview));
    });
  }
  return previews;
}
