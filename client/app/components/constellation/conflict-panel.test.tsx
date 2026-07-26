import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictPanel } from "./conflict-panel";

describe("ConflictPanel", () => {
  afterEach(cleanup);
  it("compares exact values without mutation and requires confirmation to keep mine", async () => {
    const user = userEvent.setup(); const keep = vi.fn(); const latest = vi.fn();
    render(<ConflictPanel submitted={{ title: "Mine", content: "Submitted exact" }} latest={{ title: "Theirs", content: "Latest exact" }} submittedVersion={4} latestVersion={6} onKeepMine={keep} onAcceptLatest={latest} />);
    expect(screen.getByText("Version 4")).toBeVisible(); expect(screen.getByText("Submitted exact")).toBeVisible(); expect(screen.getByText("Version 6")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Compare versions" })); expect(keep).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep mine" })); expect(screen.getByRole("dialog", { name: "Confirm keep mine" })).toBeVisible(); expect(keep).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm keep mine" })); expect(keep).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Accept latest" })); expect(latest).toHaveBeenCalledOnce();
  });

  it("keeps confirmation open and allows retry when keep-mine fails", async () => {
    const user = userEvent.setup();
    const keep = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const { getByRole, findByRole } = render(<ConflictPanel submitted={{ title: "Mine" }} latest={{ title: "Theirs" }} submittedVersion={4} latestVersion={6} onKeepMine={keep} onAcceptLatest={vi.fn()} />);
    await user.click(getByRole("button", { name: "Keep mine" }));
    await user.click(getByRole("button", { name: "Confirm keep mine" }));
    expect(await findByRole("alert")).toHaveTextContent("Retry failed");
    expect(getByRole("alertdialog", { name: "Version conflict" })).toBeVisible();
    await user.click(getByRole("button", { name: "Confirm keep mine" }));
    expect(keep).toHaveBeenCalledTimes(2);
  });
});
