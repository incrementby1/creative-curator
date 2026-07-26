import { describe, expect, it, vi } from "vitest";
import { hydratePendingConflict } from "./project-conflicts";
import type { PendingProjectEdit, PendingOperation } from "./pending-project-edits";

const project = { id: "p", version: 8 };
const nodes = [{ id: "a", title: "A", version: 3 }, { id: "b", title: "B", version: 4 }];
const edges = [{ id: "e", source_node_id: "a", target_node_id: "b", version: 2 }];
const graph = { project, nodes, edges } as never;
const edit = (operation: PendingOperation, payload: Record<string, unknown>): PendingProjectEdit => ({ schemaVersion: 1, ownerId: "u", projectId: "p", idempotencyKey: "k", expectedVersion: 5, operation, payload, createdAt: 1 });

describe("hydratePendingConflict", () => {
  it("hydrates node and edge operations with exact current records", async () => {
    const none = vi.fn().mockResolvedValue([]);
    expect(await hydratePendingConflict(edit("trash_node", { nodeId: "a", nodeVersion: 1 }), graph, none, none)).toEqual({ project, node: nodes[0] });
    expect(await hydratePendingConflict(edit("create_edge", { input: { source_node_id: "a", target_node_id: "b" } }), graph, none, none)).toEqual({ project, source_node: nodes[0], target_node: nodes[1] });
    expect(await hydratePendingConflict(edit("delete_edge", { edgeId: "e", edgeVersion: 1 }), graph, none, none)).toEqual({ project, edge: edges[0], source_node: nodes[0], target_node: nodes[1] });
  });

  it("hydrates proposal and challenge operations from authoritative endpoints", async () => {
    const proposal = { id: "q", version: 7 };
    const resolution = { id: "r", challenge_id: "a", version: 2 };
    expect(await hydratePendingConflict(edit("accept_proposal", { proposalId: "q" }), graph, async () => [proposal] as never, async () => [])).toEqual({ project, proposal });
    expect(await hydratePendingConflict(edit("resolve_challenge", { nodeId: "a", state: "resolved", note: "done" }), graph, async () => [], async () => [resolution] as never)).toEqual({ project, challenge_node: nodes[0], latest_resolution: resolution });
  });
});
