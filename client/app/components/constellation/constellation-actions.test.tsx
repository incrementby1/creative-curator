import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GraphNode, ListedProposal, NodeRevision } from "../../lib/project-types";
import { ChallengePanel } from "./challenge-panel";
import { CommandSurface } from "./command-surface";
import { NodeInspector } from "./node-inspector";
import { ProposalTray } from "./proposal-tray";

const node: GraphNode = { id: "n1", project_id: "p1", node_type: "challenge", title: "Trust gap", content: "Proof is missing", state: "working", created_by: "hermes", provenance: "Guided positioning review", tags: ["confidence:medium", "downstream:Naming"], version: 2, created_at: "2026-07-26T00:00:00Z", updated_at: "2026-07-27T00:00:00Z" };
const proposal: ListedProposal = { id: "pr1", project_id: "p1", title: "Add evidence", rationale: "Claim needs support", target_node_ids: ["n1"], canonical_hash: "hash", dependency_node_versions: [["n1", 2]], dependency_edge_versions: [], creation_source: "hermes", state: "pending", version: 1, created_at: node.created_at, updated_at: node.updated_at, candidate: { summary: "Add proof", affected_node_ids: ["n1"], proposed_nodes: [{ client_key: "proof", node_type: "evidence", title: "Customer proof", content: "Capture interviews", rationale: "Validate claim" }], proposed_edges: [{ source_key: "proof", target_key: "n1", edge_type: "supports" }] } };

describe("constellation action surfaces", () => {
  it("preserves quick-capture draft when persistence fails", async () => {
    const user = userEvent.setup();
    render(<CommandSurface busy={false} onCapture={vi.fn().mockRejectedValue(new Error("offline"))} />);
    await user.type(screen.getByLabelText("Thought title"), "Quiet confidence");
    await user.type(screen.getByLabelText("Thought details"), "Avoid inflated claims");
    await user.click(screen.getByRole("button", { name: "Capture thought" }));
    expect(screen.getByLabelText("Thought title")).toHaveValue("Quiet confidence");
    expect(screen.getByRole("alert")).toHaveTextContent("Draft preserved");
  });

  it("edits precise node fields and exposes revision history outside canvas nodes", async () => {
    const user = userEvent.setup(); const save = vi.fn().mockResolvedValue(undefined);
    const revisions: NodeRevision[] = [{ id: "r1", project_id: "p1", node_id: "n1", node_version: 1, title: "Old trust gap", content: "Earlier", node_type: "challenge", state: "working", created_by: "hermes", provenance: null, tags: [], created_at: node.created_at }];
    render(<NodeInspector connections={["Supports Audience"]} loadingRevisions={false} node={node} onSave={save} revisions={revisions} />);
    await user.clear(screen.getByLabelText("Node title")); await user.type(screen.getByLabelText("Node title"), "Evidence gap");
    await user.click(screen.getByRole("button", { name: "Save node" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "Evidence gap", expected_node_version: 2 }));
    expect(screen.getByText("Old trust gap")).toBeVisible(); expect(screen.getByText("Supports Audience")).toBeVisible();
  });

  it("previews proposal as non-approved and rejects without accepting", async () => {
    const user = userEvent.setup(); const accept = vi.fn(); const reject = vi.fn();
    render(<ProposalTray accepting={false} onAccept={accept} onReject={reject} proposals={[proposal]} />);
    expect(screen.getByText("Preview · not approved")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reject proposal" }));
    expect(reject).toHaveBeenCalledWith("pr1"); expect(accept).not.toHaveBeenCalled();
  });

  it("requires an override note and announces challenge resolution", async () => {
    const user = userEvent.setup(); const resolve = vi.fn().mockResolvedValue(undefined);
    render(<ChallengePanel challenge={node} dependencies={["Positioning decision"]} historyHref="#history" onResolve={resolve} />);
    const panel = within(screen.getByRole("region", { name: "Active challenge" }));
    expect(panel.getByText("Proof is missing")).toBeVisible(); expect(panel.getByText("Medium confidence")).toBeVisible(); expect(panel.getByText("Naming")).toBeVisible();
    await user.click(panel.getByRole("button", { name: "Override" }));
    expect(panel.getByRole("alert")).toHaveTextContent("note is required"); expect(resolve).not.toHaveBeenCalled();
    await user.type(panel.getByLabelText("Resolution note"), "Founder accepts launch risk"); await user.click(panel.getByRole("button", { name: "Override" }));
    expect(resolve).toHaveBeenCalledWith("overridden", "Founder accepts launch risk");
    expect(await screen.findByRole("status")).toHaveTextContent("Challenge overridden");
  });
});
