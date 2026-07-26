import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GraphNode } from "../../lib/project-types";
import { ProjectMapPanel } from "./project-map-panel";
const base = { project_id: "p", node_type: "decision", content: "", state: "working", created_by: "user", provenance: null, version: 1, created_at: "", updated_at: "" } as const;
const nodes: GraphNode[] = [{ ...base, id: "a", title: "Calm", tags: ["branch:calm"] }, { ...base, id: "b", title: "Bold", tags: ["branch:bold"] }];
describe("ProjectMapPanel branches", () => { it("compares and promotes a chosen semantic branch", async () => { const user = userEvent.setup(); const promote = vi.fn(); render(<ProjectMapPanel activeTypes={new Set(["decision"])} branches={["bold", "calm"]} clusters={[]} nodes={nodes} unresolvedOnly={false} onFitSelection={() => undefined} onPromote={promote} onType={() => undefined} onUnresolved={() => undefined} />); await user.click(screen.getByLabelText("Compare bold")); await user.click(screen.getByLabelText("Compare calm")); expect(screen.getByText("Bold: 1 node")).toBeVisible(); expect(screen.getByText("Calm: 1 node")).toBeVisible(); await user.click(screen.getByRole("button", { name: "Promote bold decisions" })); expect(promote).toHaveBeenCalledWith("bold"); }); });
