import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TerminalRecoveryPanel } from "./terminal-recovery-panel";

const edit = { schemaVersion: 1 as const, ownerId: "owner", projectId: "project", idempotencyKey: "legacy-key", expectedVersion: 2, operation: "update_node" as const, payload: { nodeId: "node", input: { title: "Submitted", content: "Exact" } }, createdAt: 1 };

describe("TerminalRecoveryPanel", () => {
  it("shows bounded semantic review and confirms discard with focus", async () => {
    const user = userEvent.setup(); const discard = vi.fn().mockResolvedValue(undefined);
    render(<TerminalRecoveryPanel category="invalid_request" edit={edit} onDiscard={discard} onKeepInTab={vi.fn()} />);
    expect(screen.getByLabelText("Submitted semantic values")).toHaveTextContent("Submitted"); expect(screen.getByText(/invalid_request/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Discard local recovery" })); expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus(); await user.click(screen.getByRole("button", { name: "Confirm" })); expect(discard).toHaveBeenCalledOnce();
  });

  it("retains the review and reports durable removal failure", async () => {
    const user = userEvent.setup(); const view = within(render(<TerminalRecoveryPanel category="forbidden" edit={edit} onDiscard={vi.fn()} onKeepInTab={vi.fn().mockRejectedValue(new Error("denied"))} />).container);
    await user.click(view.getByRole("button", { name: "Keep in tab" })); await user.click(view.getByRole("button", { name: "Confirm" })); expect(await view.findByText(/could not be changed/)).toBeVisible(); expect(view.getByRole("alertdialog")).toBeVisible();
  });
});
