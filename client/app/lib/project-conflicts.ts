import type { PendingProjectEdit } from "./pending-project-edits";
import type { ChallengeResolution, ListedProposal, ProjectGraph } from "./project-types";

export type ConflictValues = Readonly<Record<string, unknown>>;

export async function hydratePendingConflict(
  edit: PendingProjectEdit,
  graph: ProjectGraph,
  loadProposals: () => Promise<readonly ListedProposal[]>,
  loadResolutions: (nodeId: string) => Promise<readonly ChallengeResolution[]>,
): Promise<ConflictValues> {
  const project = graph.project;
  const node = (id: unknown) => typeof id === "string" ? graph.nodes.find((item) => item.id === id) ?? null : null;
  const edge = (id: unknown) => typeof id === "string" ? graph.edges.find((item) => item.id === id) ?? null : null;
  if (edit.operation === "create_node") {
    const input = edit.payload.input as Record<string, unknown> | undefined;
    return { project, matching_node: graph.nodes.find((item) => item.title === input?.title) ?? null };
  }
  if (edit.operation === "update_node" || edit.operation === "trash_node" || edit.operation === "restore_node") return { project, node: node(edit.payload.nodeId) };
  if (edit.operation === "create_edge") {
    const input = edit.payload.input as Record<string, unknown> | undefined;
    return { project, source_node: node(input?.source_node_id), target_node: node(input?.target_node_id) };
  }
  if (edit.operation === "delete_edge") {
    const current = edge(edit.payload.edgeId);
    return { project, edge: current, source_node: node(current?.source_node_id), target_node: node(current?.target_node_id) };
  }
  if (edit.operation === "accept_proposal" || edit.operation === "reject_proposal") {
    const proposals = await loadProposals();
    return { project, proposal: proposals.find((item) => item.id === edit.payload.proposalId) ?? null };
  }
  const challengeId = typeof edit.payload.nodeId === "string" ? edit.payload.nodeId : "";
  const resolutions = challengeId ? await loadResolutions(challengeId) : [];
  return { project, challenge_node: node(challengeId), latest_resolution: resolutions[0] ?? null };
}
