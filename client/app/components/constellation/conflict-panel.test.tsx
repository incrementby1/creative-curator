import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConflictPanel } from "./conflict-panel";

describe("ConflictPanel", () => {
  it("compares exact values without mutation and requires confirmation to keep mine", async () => {
    const user = userEvent.setup(); const keep = vi.fn(); const latest = vi.fn();
    render(<ConflictPanel submitted={{ title: "Mine", content: "Submitted exact" }} latest={{ title: "Theirs", content: "Latest exact" }} submittedVersion={4} latestVersion={6} onKeepMine={keep} onAcceptLatest={latest} />);
    expect(screen.getByText("Version 4")).toBeVisible(); expect(screen.getByText("Submitted exact")).toBeVisible(); expect(screen.getByText("Version 6")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Compare versions" })); expect(keep).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep mine" })); expect(screen.getByRole("dialog", { name: "Confirm keep mine" })).toBeVisible(); expect(keep).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm keep mine" })); expect(keep).toHaveBeenCalledOnce();
  });
});
