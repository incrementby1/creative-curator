import type { Edge, Node } from "@xyflow/react";

import type { GraphNode, ListedProposal, ProposedNode } from "../../lib/project-types";

const DEFAULT_PREVIEW_WIDTH = 244;
const DEFAULT_PREVIEW_HEIGHT = 124;
const PREVIEW_GAP = 40;
const COLLISION_EPSILON = .5;
const SPATIAL_CELL = 320;
const FALLBACK_LIMIT = 2_048;
const FALLBACK_STEP = 12;
const MAX_LAYOUT_CANDIDATES = 9_000;
const MAX_LAYOUT_COLLISION_CHECKS = 50_000;

export type CanvasBounds = Readonly<{ left: number; top: number; right: number; bottom: number }>;
export type PreviewDimensions = Readonly<{ width: number; height: number; naturalHeight?: number; detailHeight?: number }>;
export type ProposalPreviewLayoutOptions = Readonly<{
  bounds: CanvasBounds;
  dimensions: Readonly<Record<string, PreviewDimensions>>;
  metrics?: { candidates: number; collisionChecks: number };
}>;

type Box = CanvasBounds;
type LayoutBudget = { candidates: number; collisionChecks: number };

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

class SpatialIndex {
  private readonly cells = new Map<string, Box[]>();

  private keys(box: Box): string[] {
    const keys: string[] = [];
    for (let y = Math.floor(box.top / SPATIAL_CELL); y <= Math.floor(box.bottom / SPATIAL_CELL); y += 1) {
      for (let x = Math.floor(box.left / SPATIAL_CELL); x <= Math.floor(box.right / SPATIAL_CELL); x += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }

  insert(box: Box): void {
    this.keys(box).forEach((key) => this.cells.set(key, [...(this.cells.get(key) ?? []), box]));
  }

  overlaps(candidate: Box, gap: number, budget: LayoutBudget, metrics?: ProposalPreviewLayoutOptions["metrics"]): boolean {
    const expanded = { left: candidate.left - gap, top: candidate.top - gap, right: candidate.right + gap, bottom: candidate.bottom + gap };
    const nearby = new Set(this.keys(expanded).flatMap((key) => this.cells.get(key) ?? []));
    const effectiveGap = Math.max(0, gap - COLLISION_EPSILON);
    for (const box of nearby) {
      if (budget.collisionChecks <= 0) return true;
      budget.collisionChecks -= 1;
      if (metrics) metrics.collisionChecks += 1;
      if (candidate.left < box.right + effectiveGap && candidate.right + effectiveGap > box.left
          && candidate.top < box.bottom + effectiveGap && candidate.bottom + effectiveGap > box.top) return true;
    }
    return false;
  }
}

function contained(candidate: Box, bounds: CanvasBounds): boolean {
  return candidate.left >= bounds.left && candidate.top >= bounds.top
    && candidate.right <= bounds.right && candidate.bottom <= bounds.bottom;
}

function *candidatePositions(anchor: Box, occupied: readonly Box[], size: PreviewDimensions, bounds: CanvasBounds, gap: number): Generator<{ x: number; y: number }> {
  const alignedX = Math.max(bounds.left, Math.min(anchor.left, anchor.right - size.width));
  const preferred = { x: alignedX, y: anchor.bottom + gap };
  yield preferred;
  yield { x: alignedX, y: anchor.top - gap - size.height };
  yield { x: anchor.right + gap, y: anchor.top };
  yield { x: anchor.left - gap - size.width, y: anchor.top };
  yield { x: bounds.left, y: bounds.top };
  yield { x: bounds.right - size.width, y: bounds.top };
  yield { x: bounds.left, y: bounds.bottom - size.height };
  yield { x: bounds.right - size.width, y: bounds.bottom - size.height };
  for (const box of occupied) {
    yield { x: box.right + gap, y: box.top };
    yield { x: box.left - gap - size.width, y: box.top };
    yield { x: box.left, y: box.bottom + gap };
    yield { x: box.left, y: box.top - gap - size.height };
    yield { x: alignedX, y: box.bottom + gap };
    yield { x: alignedX, y: box.top - gap - size.height };
    yield { x: box.right + gap, y: anchor.top };
    yield { x: box.left - gap - size.width, y: anchor.top };
  }
  let yielded = 0;
  const maxRadius = Math.ceil(Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) / FALLBACK_STEP);
  for (let radius = 0; radius <= maxRadius && yielded < FALLBACK_LIMIT; radius += 1) {
    for (let yOffset = -radius; yOffset <= radius && yielded < FALLBACK_LIMIT; yOffset += 1) {
      for (const xOffset of radius === 0 ? [0] : [-radius, radius]) {
        yield { x: preferred.x + xOffset * FALLBACK_STEP, y: preferred.y + yOffset * FALLBACK_STEP }; yielded += 1;
      }
    }
    for (let xOffset = -radius + 1; xOffset < radius && yielded < FALLBACK_LIMIT; xOffset += 1) {
      for (const yOffset of [-radius, radius]) {
        yield { x: preferred.x + xOffset * FALLBACK_STEP, y: preferred.y + yOffset * FALLBACK_STEP }; yielded += 1;
      }
    }
  }
}

function positionNear(anchor: Box, occupied: readonly Box[], index: SpatialIndex, size: PreviewDimensions, bounds: CanvasBounds, budget: LayoutBudget, metrics?: ProposalPreviewLayoutOptions["metrics"]): { position: { x: number; y: number }; hidden: boolean } {
  const seen = new Set<string>();
  for (const gap of [PREVIEW_GAP, 0]) {
    for (const { x, y } of candidatePositions(anchor, occupied, size, bounds, gap)) {
      const key = `${gap}:${x}:${y}`; if (seen.has(key)) continue; seen.add(key);
      if (budget.candidates <= 0) return { position: { x: bounds.left, y: bounds.top }, hidden: true };
      budget.candidates -= 1;
      if (metrics) metrics.candidates += 1;
      const candidate = { left: x, top: y, right: x + size.width, bottom: y + size.height };
      if (contained(candidate, bounds) && !index.overlaps(candidate, gap, budget, metrics)) return { position: { x, y }, hidden: false };
    }
  }
  return { position: { x: bounds.left, y: bounds.top }, hidden: true };
}

export function proposalPreviewKey(proposalId: string, clientKey: string): string {
  return `${proposalId}:${clientKey}`;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(value: string): string[] {
  return [...graphemeSegmenter.segment(value)].map((part) => part.segment);
}

function visualUnits(grapheme: string): number {
  if (grapheme === "\n") return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2.25;
  if (/\s/u.test(grapheme)) return .6;
  if (/[ilI.,'`:;|!]/u.test(grapheme)) return .65;
  return 2;
}

function wrappedLines(value: string, availablePixels: number, pixelsPerUnit: number): number {
  let lines = 1; let used = 0;
  for (const grapheme of graphemes(value)) {
    if (grapheme === "\n") { lines += 1; used = 0; continue; }
    const width = visualUnits(grapheme) * pixelsPerUnit;
    if (used > 0 && used + width > availablePixels) { lines += 1; used = width; } else used += width;
  }
  return lines;
}

export function estimateProposalPreviewDimensions(item: ProposedNode, bounds: CanvasBounds): PreviewDimensions {
  const availableWidth = Math.max(1, bounds.right - bounds.left);
  const availableHeight = Math.max(1, bounds.bottom - bounds.top);
  const bodyUnits = graphemes(item.content).reduce((total, grapheme) => total + visualUnits(grapheme), 0);
  const desiredWidth = 260 + Math.max(0, bodyUnits - 100) * .85;
  const width = Math.min(540, availableWidth, Math.max(208, Math.min(desiredWidth, availableWidth - 24)));
  const innerWidth = Math.max(1, width - 28);
  const titleLines = wrappedLines(item.title, innerWidth, 7);
  const contentLines = wrappedLines(item.content, innerWidth, 6);
  const naturalHeight = Math.max(DEFAULT_PREVIEW_HEIGHT, 90 + titleLines * 20 + contentLines * 18);
  const detailHeight = Math.min(availableHeight, Math.max(180, 136 + titleLines * 20));
  return { width, height: Math.min(availableHeight, naturalHeight), naturalHeight, detailHeight };
}

export function createProposalPreviewNodes(projectId: string, proposals: readonly ListedProposal[], canvasNodes: readonly Node[], options: ProposalPreviewLayoutOptions): Node[] {
  const canvasById = new Map(canvasNodes.map((node) => [node.id, node]));
  const occupied = canvasNodes.map(nodeBox);
  const index = new SpatialIndex(); occupied.forEach((box) => index.insert(box));
  const budget = { candidates: MAX_LAYOUT_CANDIDATES, collisionChecks: MAX_LAYOUT_COLLISION_CHECKS };
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
      const detailSize = requested.detailHeight ? { width: size.width, height: requested.detailHeight } : null;
      let previewDetail = Boolean(requested.naturalHeight && requested.naturalHeight > size.height);
      let renderedSize = previewDetail && detailSize ? detailSize : size;
      let placement = positionNear(anchor, occupied, index, renderedSize, options.bounds, budget, options.metrics);
      if (placement.hidden && !previewDetail && detailSize && requested.naturalHeight && requested.naturalHeight > detailSize.height) {
        previewDetail = true; renderedSize = detailSize;
        placement = positionNear(anchor, occupied, index, renderedSize, options.bounds, budget, options.metrics);
      }
      const preview: Node = {
        id: `preview:${proposal.id}:${item.client_key}`,
        type: "brand",
        connectable: false,
        draggable: false,
        focusable: false,
        selectable: false,
        ariaLabel: `Proposal preview: ${item.title} (not approved)`,
        hidden: placement.hidden,
        position: placement.position,
        data: {
          preview: true,
          previewDetail,
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
        style: renderedSize,
      };
      previews.push(preview);
      if (!preview.hidden) { const box = nodeBox(preview); occupied.push(box); index.insert(box); }
    });
  }
  return previews;
}

export function createProposalPreviewEdges(proposals: readonly ListedProposal[], previews: readonly Node[], visibleNodeIds?: ReadonlySet<string>): Edge[] {
  const visiblePreviews = new Set(previews.filter((preview) => !preview.hidden).map((preview) => preview.id));
  return proposals.flatMap((proposal) => {
    const proposedKeys = new Set(proposal.candidate.proposed_nodes.map((node) => node.client_key));
    const endpoint = (key: string) => proposedKeys.has(key) ? `preview:${proposal.id}:${key}` : key;
    return proposal.candidate.proposed_edges.flatMap((edge, index) => {
      const source = endpoint(edge.source_key); const target = endpoint(edge.target_key);
      const endpointVisible = (id: string) => id.startsWith("preview:") ? visiblePreviews.has(id) : !visibleNodeIds || visibleNodeIds.has(id);
      if (!endpointVisible(source) || !endpointVisible(target)) return [];
      return [{
        id: `preview-edge:${proposal.id}:${index}`, source, target, type: "semantic", focusable: false, selectable: false,
        ariaLabel: `Proposal preview relationship: ${edge.edge_type.replaceAll("_", " ")} (not approved)`,
        data: { edgeType: edge.edge_type, preview: true }, style: { opacity: .65 },
      } as Edge];
    });
  });
}
