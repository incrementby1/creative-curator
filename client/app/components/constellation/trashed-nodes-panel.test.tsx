import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GraphNode } from "../../lib/project-types";
import { TrashedNodesPanel } from "./trashed-nodes-panel";
const node: GraphNode = { id: "n", project_id: "p", node_type: "idea", title: "Discarded route", content: "Old", state: "trash", created_by: "user", provenance: null, tags: [], version: 2, created_at: "", updated_at: "" };
describe("TrashedNodesPanel", () => { it("lists durable trash and restores explicitly", async () => { const restore = vi.fn().mockResolvedValue(undefined); render(<TrashedNodesPanel nodes={[node]} onRestore={restore} />); fireEvent.click(screen.getByRole("button", { name: "Restore Discarded route" })); await waitFor(() => expect(restore).toHaveBeenCalledWith(node)); }); });
