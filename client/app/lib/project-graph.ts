import type { AcceptedProposal, GraphEdge, GraphNode, ListedProposal, ProposalWithCandidate } from "./project-types";

export type Point = Readonly<{ x: number; y: number }>;
export type SemanticGraph = Readonly<{ nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }>;
type SemanticHistory = Readonly<{ past: readonly SemanticGraph[]; future: readonly SemanticGraph[]; limit: number }>;
export type ProposalPreview = Readonly<{
  proposalId: string;
  nodes: readonly (GraphNode & Readonly<{ preview: true; clientKey: string }>)[];
  edges: readonly (GraphEdge & Readonly<{ preview: true }>)[];
}>;
export type ProjectGraphState = Readonly<{
  semantic: SemanticGraph;
  layout: Readonly<{ positions: Readonly<Record<string, Point>> }>;
  ui: Readonly<{ selectedNodeIds: readonly string[]; selectedEdgeIds: readonly string[]; viewport: Readonly<{ x: number; y: number; zoom: number }> }>;
  preview: ProposalPreview | null;
  history: SemanticHistory;
}>;

const snapshot = (semantic: SemanticGraph): SemanticGraph => ({ nodes: [...semantic.nodes], edges: [...semantic.edges] });
const pushHistory = (state: ProjectGraphState, semantic: SemanticGraph): ProjectGraphState => ({
  ...state, semantic,
  history: { ...state.history, past: [...state.history.past, snapshot(state.semantic)].slice(-state.history.limit), future: [] },
});

export function createGraphState(nodes: readonly GraphNode[] = [], edges: readonly GraphEdge[] = [], options: { historyLimit?: number } = {}): ProjectGraphState {
  return {
    semantic: { nodes: [...nodes], edges: [...edges] }, layout: { positions: {} },
    ui: { selectedNodeIds: [], selectedEdgeIds: [], viewport: { x: 0, y: 0, zoom: 1 } },
    preview: null, history: { past: [], future: [], limit: Math.max(1, options.historyLimit ?? 50) },
  };
}

export function quickCapture(state: ProjectGraphState, node: GraphNode): ProjectGraphState {
  return pushHistory(state, { ...state.semantic, nodes: [...state.semantic.nodes, node] });
}
export function replaceSemantic(state: ProjectGraphState, semantic: SemanticGraph): ProjectGraphState {
  return pushHistory(state, snapshot(semantic));
}
export function undoSemantic(state: ProjectGraphState): ProjectGraphState {
  const previous = state.history.past.at(-1);
  if (!previous) return state;
  return { ...state, semantic: previous, preview: null, history: {
    ...state.history, past: state.history.past.slice(0, -1),
    future: [snapshot(state.semantic), ...state.history.future].slice(0, state.history.limit),
  } };
}
export function redoSemantic(state: ProjectGraphState): ProjectGraphState {
  const next = state.history.future[0];
  if (!next) return state;
  return { ...state, semantic: next, preview: null, history: {
    ...state.history, past: [...state.history.past, snapshot(state.semantic)].slice(-state.history.limit), future: state.history.future.slice(1),
  } };
}

export function previewProposal(state: ProjectGraphState, value: ProposalWithCandidate | ListedProposal): ProjectGraphState {
  const proposal = "proposal" in value ? value.proposal : value;
  const candidate = value.candidate;
  const ids = new Map<string, string>();
  for (const node of state.semantic.nodes) ids.set(node.id, node.id);
  const now = new Date().toISOString();
  const nodes = candidate.proposed_nodes.map((item) => {
    const id = `preview:${proposal.id}:${item.client_key}`;
    ids.set(item.client_key, id);
    return { id, project_id: proposal.project_id, node_type: item.node_type, title: item.title,
      content: item.content, state: "working" as const, created_by: "hermes" as const,
      provenance: item.rationale, tags: [], version: 0, created_at: now, updated_at: now,
      preview: true as const, clientKey: item.client_key };
  });
  if (candidate.proposed_edges.some((item) => !ids.has(item.source_key) || !ids.has(item.target_key) || item.source_key === item.target_key)) {
    throw new Error("Proposal edge references unknown node or self-reference.");
  }
  const edges = candidate.proposed_edges.map((item, index) => ({
    id: `preview:${proposal.id}:edge:${index}`, project_id: proposal.project_id,
    source_node_id: ids.get(item.source_key) ?? item.source_key, target_node_id: ids.get(item.target_key) ?? item.target_key,
    edge_type: item.edge_type, label: null, version: 0, created_at: now, updated_at: now, preview: true as const,
  }));
  return { ...state, preview: { proposalId: proposal.id, nodes, edges } };
}
export function rejectProposalPreview(state: ProjectGraphState): ProjectGraphState { return { ...state, preview: null }; }
function reconcileById<T extends Readonly<{ id: string }>>(current: readonly T[], incoming: readonly T[]): readonly T[] {
  const replacements = new Map(incoming.map((item) => [item.id, item]));
  const reconciled = current.map((item) => replacements.get(item.id) ?? item);
  const currentIds = new Set(current.map((item) => item.id));
  return [...reconciled, ...incoming.filter((item) => !currentIds.has(item.id))];
}
export function acceptProposalResult(state: ProjectGraphState, result: AcceptedProposal): ProjectGraphState {
  const projectId = result.proposal.project_id;
  if (result.proposal.state !== "accepted"
      || state.semantic.nodes.some((node) => node.project_id !== projectId)
      || state.semantic.edges.some((edge) => edge.project_id !== projectId)
      || result.nodes.some((node) => !node.id || node.project_id !== projectId)
      || result.edges.some((edge) => !edge.id || edge.project_id !== projectId)) {
    throw new Error("Accepted proposal has invalid project scope or state.");
  }
  if (new Set(result.nodes.map((node) => node.id)).size !== result.nodes.length
      || new Set(result.edges.map((edge) => edge.id)).size !== result.edges.length) {
    throw new Error("Accepted proposal contains duplicate record IDs.");
  }
  const semantic = { nodes: reconcileById(state.semantic.nodes, result.nodes), edges: reconcileById(state.semantic.edges, result.edges) };
  const nodeIds = new Set(semantic.nodes.map((node) => node.id));
  if (semantic.edges.some((edge) => edge.source_node_id === edge.target_node_id
      || !nodeIds.has(edge.source_node_id) || !nodeIds.has(edge.target_node_id))) {
    throw new Error("Accepted proposal edge references unknown node or self-reference.");
  }
  if (JSON.stringify(semantic) === JSON.stringify(state.semantic)) return { ...state, preview: null };
  return pushHistory({ ...state, preview: null }, semantic);
}
export function setLayoutPosition(state: ProjectGraphState, nodeId: string, position: Point): ProjectGraphState {
  return { ...state, layout: { positions: { ...state.layout.positions, [nodeId]: { ...position } } } };
}
export function setSelection(state: ProjectGraphState, selectedNodeIds: readonly string[], selectedEdgeIds: readonly string[]): ProjectGraphState {
  return { ...state, ui: { ...state.ui, selectedNodeIds: [...selectedNodeIds], selectedEdgeIds: [...selectedEdgeIds] } };
}
export function setViewport(state: ProjectGraphState, viewport: { x: number; y: number; zoom: number }): ProjectGraphState {
  return { ...state, ui: { ...state.ui, viewport: { ...viewport } } };
}
