import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EditorToolbar } from "./editor-toolbar";
import { ThemeSelector } from "./theme-selector";
import { WorkbenchPanel } from "./workbench-panel";
import type { ThemeChoice } from "../../lib/project-types";

function Fixture({ theme }: { theme: ThemeChoice }) {
  return <main data-theme={theme}>
    <EditorToolbar aria-label="Project controls">
      <span role="status">Graph saved</span>
      <ThemeSelector effectiveTheme={theme} onGlobalTheme={() => undefined} onProjectTheme={() => undefined} />
    </EditorToolbar>
    <WorkbenchPanel as="aside" aria-label="Inspector"><button type="button">Review challenge</button></WorkbenchPanel>
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
});
