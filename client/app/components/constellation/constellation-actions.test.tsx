import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GraphNode, ListedProposal, NodeRevision } from "../../lib/project-types";
import { ChallengePanel } from "./challenge-panel";
import { CommandSurface } from "./command-surface";
import { NodeInspector } from "./node-inspector";
import { ProposalTray } from "./proposal-tray";

const node: GraphNode = { id: "n1", project_id: "p1", node_type: "challenge", title: "Trust gap", content: "Proof is missing", state: "working", created_by: "hermes", provenance: "Guided positioning review", tags: [], challenge_dependencies: ["Positioning decision"], challenge_confidence: 80, challenge_downstream_effect: "Naming", version: 2, created_at: "2026-07-26T00:00:00Z", updated_at: "2026-07-27T00:00:00Z" };
const proposal: ListedProposal = { id: "pr1", project_id: "p1", title: "Add evidence", rationale: "Claim needs support", target_node_ids: ["n1"], canonical_hash: "hash", dependency_node_versions: [["n1", 2]], dependency_edge_versions: [], creation_source: "hermes", state: "pending", version: 1, created_at: node.created_at, updated_at: node.updated_at, candidate: { summary: "Add proof", affected_node_ids: ["n1"], proposed_nodes: [{ client_key: "proof", node_type: "evidence", title: "Customer proof", content: "Capture interviews", rationale: "Validate claim" }], proposed_edges: [{ source_key: "proof", target_key: "n1", edge_type: "supports" }] } };

describe("constellation action surfaces", () => {
  it("acknowledges challenge without presenting it as terminal", async () => {
    const user = userEvent.setup(); const resolve = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<ChallengePanel challenge={node} dependencies={[]} historyHref="#history" onResolve={resolve} resolutions={[]} />);
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(resolve).toHaveBeenCalledWith("acknowledged", "Acknowledged for review");
    unmount();
  });
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
    render(<NodeInspector connections={[{ id: "edge-supports-audience", label: "Supports Audience" }]} height={124} loadingRevisions={false} node={node} onSave={save} revisions={revisions} width={244} />);
    await user.clear(screen.getByLabelText("Node title")); await user.type(screen.getByLabelText("Node title"), "Evidence gap");
    await user.click(screen.getByRole("button", { name: "Save node" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "Evidence gap", expected_node_version: 2 }));
    expect(screen.getByText("Old trust gap")).toBeVisible(); expect(screen.getByText("Supports Audience")).toBeVisible();
  });

  it("renders parallel same-label connections by edge identity without React key warnings", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<NodeInspector connections={[
      { id: "edge-parallel-1", label: "supports Audience" },
      { id: "edge-parallel-2", label: "supports Audience" },
    ]} height={124} loadingRevisions={false} node={node} onSave={vi.fn()} revisions={[]} width={244} />);
    expect(screen.getAllByText("supports Audience")).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
  });

  it("focuses and acknowledges each inspector restoration token exactly once", () => {
    const handled = vi.fn(); const save = vi.fn();
    const { container, rerender } = render(<NodeInspector connections={[]} focusRequest="restore-1" height={124} loadingRevisions={false} node={node} onFocusRequestHandled={handled} onSave={save} revisions={[]} width={244} />);
    const inspector = within(container);
    expect(inspector.getByLabelText("Node title")).toHaveFocus(); expect(handled).toHaveBeenCalledOnce();
    rerender(<NodeInspector connections={[]} focusRequest="restore-1" height={124} loadingRevisions={false} node={node} onFocusRequestHandled={handled} onSave={save} revisions={[]} width={244} />);
    expect(handled).toHaveBeenCalledOnce();
    inspector.getByLabelText("Content").focus();
    rerender(<NodeInspector connections={[]} focusRequest="restore-2" height={124} loadingRevisions={false} node={node} onFocusRequestHandled={handled} onSave={save} revisions={[]} width={244} />);
    expect(inspector.getByLabelText("Node title")).toHaveFocus(); expect(handled).toHaveBeenLastCalledWith("restore-2");
  });

  it("connects nodes and applies bounded node size by keyboard", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockResolvedValue(undefined);
    const onResize = vi.fn().mockResolvedValue(undefined);
    const target = { ...node, id: "n2", title: "Audience" };
    const { container } = render(<NodeInspector availableNodes={[node, target]} connections={[]} height={124} loadingRevisions={false} node={node} onConnect={onConnect} onResize={onResize} onSave={vi.fn()} revisions={[]} width={244} />);
    const inspector = within(container);

    expect(inspector.getByRole("heading", { name: "Connect nodes" })).toBeVisible();
    expect(inspector.getByRole("heading", { name: "Size & position" })).toBeVisible();
    await user.selectOptions(inspector.getByLabelText("Connection target"), "n2");
    await user.selectOptions(inspector.getByLabelText("Relationship type"), "depends_on");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onConnect).toHaveBeenCalledWith("n2", "depends_on");

    const width = inspector.getByLabelText("Node width");
    const height = inspector.getByLabelText("Node height");
    expect(width).toHaveAttribute("min", "208"); expect(width).toHaveAttribute("max", "1200");
    expect(height).toHaveAttribute("min", "112"); expect(height).toHaveAttribute("max", "900");
    await user.clear(width); await user.type(width, "320");
    await user.clear(height); await user.type(height, "180");
    await user.tab(); await user.keyboard("{Enter}");
    expect(onResize).toHaveBeenCalledWith(320, 180);
    expect(inspector.getByLabelText("Node size status")).toHaveTextContent("Node size saved.");
  });

  it("preserves node size values after failure and clears stale status on edit", async () => {
    const user = userEvent.setup();
    const onResize = vi.fn().mockRejectedValue(new Error("offline"));
    const { container } = render(<NodeInspector connections={[]} height={124} loadingRevisions={false} node={node} onResize={onResize} onSave={vi.fn()} revisions={[]} width={244} />);
    const inspector = within(container); const width = inspector.getByLabelText("Node width"); const height = inspector.getByLabelText("Node height");
    await user.clear(width); await user.type(width, "320"); await user.clear(height); await user.type(height, "180");
    await user.click(inspector.getByRole("button", { name: "Apply node size" }));
    expect(width).toHaveValue(320); expect(height).toHaveValue(180);
    expect(inspector.getByLabelText("Node size status")).toHaveTextContent("Node size was not saved. Values preserved.");
    await user.type(width, "1");
    expect(inspector.getByLabelText("Node size status")).toBeEmptyDOMElement();
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
    render(<ChallengePanel challenge={node} dependencies={["Positioning decision"]} historyHref="#challenge-resolution-history-n1" onResolve={resolve} />);
    const panel = within(screen.getByRole("region", { name: "Active challenge" }));
    expect(panel.getByText("Proof is missing")).toBeVisible(); expect(panel.getByText("80%")).toBeVisible(); expect(panel.getByText("Naming")).toBeVisible();
    await user.click(panel.getByRole("button", { name: "Override" }));
    expect(panel.getByRole("alert")).toHaveTextContent("note is required"); expect(resolve).not.toHaveBeenCalled();
    await user.type(panel.getByLabelText("Resolution note"), "Founder accepts launch risk"); await user.click(panel.getByRole("button", { name: "Override" }));
    expect(resolve).toHaveBeenCalledWith("overridden", "Founder accepts launch risk");
    expect(await screen.findByRole("status")).toHaveTextContent("Challenge overridden");
    expect(screen.getByRole("heading", { name: "Resolution history" }).closest("section")).toHaveAttribute("id", "challenge-resolution-history-n1");
  });

  it("renders hydrated challenge resolution records in their own anchored history", () => {
    render(<ChallengePanel challenge={node} dependencies={[]} historyHref="#challenge-resolution-history-n1" onResolve={vi.fn()} resolutions={[{
      id: "resolution-42", project_id: "p1", challenge_id: "n1", resolution: "Accepted with launch guardrails",
      state: "overridden", resolved_by: "owner-7", version: 1,
      created_at: "2026-07-27T09:30:00Z", updated_at: "2026-07-27T09:30:00Z",
    }]} />);
    const resolvedPanel = screen.getByRole("region", { name: "Resolved challenge" });
    const history = within(resolvedPanel).getByRole("heading", { name: "Resolution history" }).closest("section")!;
    expect(history).toHaveAttribute("id", "challenge-resolution-history-n1");
    expect(within(history).getByText("Accepted with launch guardrails")).toBeVisible();
    expect(within(history).getByText(/Resolved by owner-7/)).toBeVisible();
    expect(history.querySelector('[data-resolution-id="resolution-42"]')).not.toBeNull();
    expect(history.querySelector('time[datetime="2026-07-27T09:30:00Z"]')).not.toBeNull();
  });
});
