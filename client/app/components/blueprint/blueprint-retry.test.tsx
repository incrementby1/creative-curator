import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlueprintEntry } from "./blueprint-entry";

const create = vi.fn();
const authClient = {};
const graph = { project: { id: "p", owner_id: "u", title: "Brand", status: "active", theme: "paper", version: 7, created_at: "", updated_at: "" }, nodes: [], edges: [], layout_version: 0, layout: {}, layout_dimensions: {}, annotation_version: 0, annotations: [], theme: "paper" };
vi.mock("../auth/auth-provider", () => ({ useAuth: () => ({ client: authClient, ready: true, user: { id: "u" } }) }));
vi.mock("../../lib/projects-api", () => ({ createProjectsApi: () => ({ loadProject: vi.fn().mockResolvedValue(graph), getBlueprintReadiness: vi.fn().mockResolvedValue({ project_id: "p", project_version: 7, ready: false, sections: {}, warnings: ["purpose"] }), listBlueprintSnapshots: vi.fn().mockResolvedValue([]), createBlueprintSnapshot: create }) }));

describe("Blueprint retry", () => {
  beforeEach(() => create.mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ id: "s", project_id: "p", project_title: "Brand", name: "Snapshot", node_ids: [], edge_ids: [], version: 1, created_at: "2026-01-01T00:00:00Z", project_version: 7, sequence: 1, readiness_warnings: [], unresolved_assumption_ids: [], sections: {} }));
  it("retries exact captured graph version and offers cancel", async () => {
    render(<BlueprintEntry projectId="p" />); await screen.findByRole("button", { name: "Create snapshot" });
    fireEvent.click(screen.getByRole("button", { name: "Create snapshot" }));
    await screen.findByRole("button", { name: "Retry version 7" }); fireEvent.click(screen.getByRole("button", { name: "Retry version 7" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create snapshot" })).toBeEnabled());
    expect(create.mock.calls).toEqual([["p", 7], ["p", 7]]);
  });
});
