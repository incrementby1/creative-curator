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
    const { props, rerender } = renderToolbar({ mode: "draw" });
    expect(screen.getByRole("button", { name: "Draw" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-keyshortcuts", "V");
    expect(screen.getByRole("button", { name: "Connect" })).toHaveAttribute("aria-keyshortcuts", "C");
    expect(screen.getByRole("button", { name: "Draw" })).toHaveAttribute("aria-keyshortcuts", "D");
    expect(screen.getByRole("button", { name: "Erase" })).toHaveAttribute("aria-keyshortcuts", "E");
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    for (const label of ["Select", "Connect", "Draw", "Erase"] as const) {
      await user.click(screen.getByRole("button", { name: label }));
    }
    for (const label of ["Add thought", "Add media", "Undo"] as const) {
      await user.click(screen.getByRole("button", { name: label }));
    }
    rerender(<CanvasToolbar {...props} canRedo />);
    await user.click(screen.getByRole("button", { name: "Redo" }));

    expect(vi.mocked(props.onMode).mock.calls.map(([mode]) => mode)).toEqual(["select", "connect", "draw", "erase"]);
    expect(props.onAddThought).toHaveBeenCalledOnce();
    expect(props.onAddMedia).toHaveBeenCalledOnce();
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onRedo).toHaveBeenCalledOnce();
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

  it("assigns distinct tooltip descriptions when hover and focus tooltips are open together", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const select = screen.getByRole("button", { name: "Select" });
    const draw = screen.getByRole("button", { name: "Draw" });
    await user.hover(select);
    fireEvent.focus(draw);

    const tooltips = screen.getAllByRole("tooltip");
    const selectTooltip = tooltips.find((tooltip) => tooltip.textContent === "Select");
    const drawTooltip = tooltips.find((tooltip) => tooltip.textContent === "Draw");
    expect(selectTooltip).toBeDefined();
    expect(drawTooltip).toBeDefined();
    expect(selectTooltip!.id).not.toBe(drawTooltip!.id);
    expect(select).toHaveAttribute("aria-describedby", selectTooltip!.id);
    expect(draw).toHaveAttribute("aria-describedby", drawTooltip!.id);
  });
});
