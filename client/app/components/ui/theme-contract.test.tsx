import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EditorToolbar } from "./editor-toolbar";
import { ThemeSelector } from "./theme-selector";
import { WorkbenchPanel } from "./workbench-panel";
import type { ThemeChoice } from "../../lib/project-types";

function Fixture({ theme }: { theme: ThemeChoice }) {
  return <main data-theme={theme}>
    <EditorToolbar aria-label="Project controls">
      <span role="status">Graph saved</span>
      <ThemeSelector effectiveTheme={theme} globalTheme="paper" projectTheme={theme} onGlobalTheme={() => undefined} onProjectTheme={() => undefined} />
    </EditorToolbar>
    <WorkbenchPanel as="aside" aria-label="Inspector"><h2>Audience decision</h2><p><span>Decision</span> · <span>Approved</span></p><p>Supports Evidence: customer interviews</p><button type="button">Review challenge</button></WorkbenchPanel>
  </main>;
}

describe("workbench theme contract", () => {
  it.each(["paper", "graphite", "project"] as const)("keeps structure and accessible language in %s", (theme) => {
    const { container } = render(<Fixture theme={theme} />);
    const view = within(container);
    expect(container.querySelectorAll("main > *")).toHaveLength(2);
    expect(view.getByRole("toolbar", { name: "Project controls" })).toBeVisible();
    expect(view.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    expect(view.getByRole("status")).toHaveTextContent("Graph saved");
    expect(view.getAllByRole("button").map((button) => button.textContent)).toEqual(["Theme", "Review challenge"]);
  });

  it("keeps realistic project DOM and geometry hooks identical across themes", () => {
    const structures = (["paper", "graphite", "project"] as const).map((theme) => {
      const { container, unmount } = render(<Fixture theme={theme} />);
      container.querySelector("main")?.removeAttribute("data-theme");
      const structure = container.innerHTML; unmount(); return structure;
    });
    expect(new Set(structures).size).toBe(1);
  });

  it("controls global default and nullable project override independently", () => {
    const global = vi.fn(); const project = vi.fn();
    const { container, rerender } = render(<ThemeSelector effectiveTheme="project" globalTheme="graphite" projectTheme="project" onGlobalTheme={global} onProjectTheme={project} />);
    const view = within(container);
    fireEvent.click(view.getByRole("button", { name: "Theme" }));
    expect(view.getByLabelText("Project appearance")).toHaveValue("project");
    expect(view.getByLabelText("Global default")).toHaveValue("graphite");
    fireEvent.change(view.getByLabelText("Project appearance"), { target: { value: "inherit" } });
    expect(project).toHaveBeenCalledWith(null);
    rerender(<ThemeSelector effectiveTheme="graphite" globalTheme="graphite" projectTheme={null} onGlobalTheme={global} onProjectTheme={project} />);
    expect(view.getByLabelText("Project appearance")).toHaveValue("inherit");
    expect(view.getByText("Effective theme: Graphite")).toBeVisible();
  });
});
