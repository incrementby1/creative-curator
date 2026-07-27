import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GraphNode } from "../../lib/project-types";
import { NodeInspector } from "./node-inspector";

const node: GraphNode = { id: "n", project_id: "p", node_type: "decision", title: "Palette", content: "Forest and paper", state: "approved", created_by: "user", provenance: null, tags: ["section:visual-direction", "branch:launch", "palette:#1F4D3A,#F5EBDD"], version: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

describe("NodeInspector taxonomy", () => {
  it("edits Blueprint section and typed project structure without losing tags", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<NodeInspector connections={[]} height={124} loadingRevisions={false} node={node} onSave={save} revisions={[]} width={244} />);
    fireEvent.change(screen.getByLabelText("Blueprint section"), { target: { value: "purpose" } });
    fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "Core story" } });
    fireEvent.click(screen.getByRole("button", { name: "Save node" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].tags).toContain("section:purpose");
    expect(save.mock.calls[0][0].tags).toContain("branch:core-story");
  });
});
