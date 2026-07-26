import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeldRecoveryPanel } from "./held-recovery-panel";

const edit = { schemaVersion: 1 as const, ownerId: "owner", projectId: "project", idempotencyKey: "held-key", expectedVersion: 2, operation: "update_node" as const, payload: { nodeId: "node", input: { title: "Recovered title", content: "Recovered content" } }, createdAt: 1 };

describe("HeldRecoveryPanel", () => {
  it("shows bounded values and confirms successful apply", async () => {
    const user = userEvent.setup(); const apply = vi.fn().mockResolvedValue(undefined);
    render(<HeldRecoveryPanel edits={[edit]} onApply={apply} onDiscard={vi.fn()} />);
    expect(screen.getByLabelText("Held submitted semantic values")).toHaveTextContent("Recovered title");
    await user.click(screen.getByRole("button", { name: "Apply recovered edit" })); await user.click(screen.getByRole("button", { name: "Confirm apply" }));
    expect(apply).toHaveBeenCalledWith(edit); expect(await screen.findByText("Recovered edit saved.")).toBeVisible();
  });

  it("retains failed apply and supports confirmed discard", async () => {
    const user = userEvent.setup(); const discard = vi.fn().mockResolvedValue(undefined);
    const view = within(render(<HeldRecoveryPanel edits={[edit]} onApply={vi.fn().mockRejectedValue(new Error("rejected"))} onDiscard={discard} />).container);
    await user.click(view.getByRole("button", { name: "Apply recovered edit" })); await user.click(view.getByRole("button", { name: "Confirm apply" }));
    expect(await view.findByText(/not saved/)).toBeVisible(); expect(view.getByText("Recovered title", { exact: false })).toBeVisible();
    await user.click(view.getByRole("button", { name: "Discard in-tab recovery" })); await user.click(view.getByRole("button", { name: "Confirm discard" }));
    expect(discard).toHaveBeenCalledWith(edit);
  });
});
