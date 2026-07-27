import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasToolbar } from "./canvas-toolbar";

afterEach(cleanup);

function renderToolbar(overrides: Partial<React.ComponentProps<typeof CanvasToolbar>> = {}) {
  const props: React.ComponentProps<typeof CanvasToolbar> = {
    mode: "select",
    canUndo: true,
    canRedo: false,
    onMode: vi.fn(),
    onAddThought: vi.fn(),
    onAddMedia: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
  return { ...render(<CanvasToolbar {...props} />), props };
}

describe("CanvasToolbar", () => {
  it("renders exactly eight icon-only tools in the required order", () => {
    const { container } = renderToolbar();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Select", "Connect", "Draw", "Erase", "Add thought", "Add media", "Undo", "Redo",
    ]);
    expect(buttons).toHaveLength(8);
    expect(container.querySelectorAll(".canvas-toolbar__divider")).toHaveLength(2);
    expect(container.querySelectorAll("button svg")).toHaveLength(8);
    for (const button of buttons) expect(button).toHaveTextContent("");
    expect(screen.queryByText("Keyboard graph controls")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Undo graph|Redo graph|Undo annotations|Redo annotations/)).not.toBeInTheDocument();
  });

  it("exposes mode state, shortcuts, callbacks, and history availability", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar({ mode: "draw" });
    expect(screen.getByRole("button", { name: "Draw" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-keyshortcuts", "V");
    expect(screen.getByRole("button", { name: "Connect" })).toHaveAttribute("aria-keyshortcuts", "C");
    expect(screen.getByRole("button", { name: "Draw" })).toHaveAttribute("aria-keyshortcuts", "D");
    expect(screen.getByRole("button", { name: "Erase" })).toHaveAttribute("aria-keyshortcuts", "E");
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: "Add thought" }));
    await user.click(screen.getByRole("button", { name: "Add media" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(props.onMode).toHaveBeenCalledWith("connect");
    expect(props.onAddThought).toHaveBeenCalledOnce();
    expect(props.onAddMedia).toHaveBeenCalledOnce();
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onRedo).not.toHaveBeenCalled();
  });

  it("shows a described tooltip on hover and dismisses it on Escape or pointer leave", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const select = screen.getByRole("button", { name: "Select" });
    await user.hover(select);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Select");
    expect(select).toHaveAttribute("aria-describedby", tooltip.id);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(select).not.toHaveAttribute("aria-describedby");

    await user.hover(select);
    await user.unhover(select);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows a described tooltip on focus and dismisses it on blur", () => {
    renderToolbar();
    const draw = screen.getByRole("button", { name: "Draw" });
    fireEvent.focus(draw);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Draw");
    expect(draw).toHaveAttribute("aria-describedby", tooltip.id);
    fireEvent.blur(draw);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
