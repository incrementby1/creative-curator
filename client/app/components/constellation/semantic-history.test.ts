import { describe, expect, it, vi } from "vitest";
import type { GraphNode } from "../../lib/project-types";
import { MAX_SEMANTIC_HISTORY, loadSemanticHistory, saveSemanticHistory, type SemanticCommand } from "./semantic-history";

const node = (id: string, projectId = "11111111-1111-4111-8111-111111111111"): GraphNode => ({
  id, project_id: projectId, node_type: "idea", title: "Thought", content: "Content", state: "working",
  created_by: "user", provenance: null, tags: [], version: 1,
  created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:00Z",
});
const command = (index: number): SemanticCommand => ({ kind: "node", node: node(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`) });

describe("semantic browser history", () => {
  it("bounds saved commands to one 50-command history", () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
    expect(saveSemanticHistory(storage, "history", { past: Array.from({ length: 70 }, (_, index) => command(index)), future: [] })).toBe(true);
    const saved = JSON.parse(vi.mocked(storage.setItem).mock.calls[0][1]) as { past: unknown[]; future: unknown[] };
    expect(saved.past).toHaveLength(MAX_SEMANTIC_HISTORY);
    expect(saved.future).toHaveLength(0);
  });

  it("discards malformed, extra-field, cross-project, and invalid-id commands", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    for (const value of [
      { past: [{ kind: "node", node: { ...node("00000000-0000-4000-8000-000000000001"), project_id: "22222222-2222-4222-8222-222222222222" } }], future: [] },
      { past: [{ ...command(1), unexpected: true }], future: [] },
      { past: [{ kind: "node", node: { ...node("not-an-id") } }], future: [] },
      { past: "bad", future: [] },
    ]) {
      const storage = { getItem: vi.fn(() => JSON.stringify(value)), removeItem: vi.fn(), setItem: vi.fn() } as unknown as Storage;
      expect(loadSemanticHistory(storage, "history", projectId)).toEqual({ past: [], future: [], persistenceAvailable: false });
      expect(storage.removeItem).toHaveBeenCalledWith("history");
    }
  });

  it("never throws when storage read, write, or cleanup is denied", () => {
    const denied = { getItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
      setItem: vi.fn(() => { throw new DOMException("full", "QuotaExceededError"); }),
      removeItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }) } as unknown as Storage;
    expect(() => loadSemanticHistory(denied, "history", "11111111-1111-4111-8111-111111111111")).not.toThrow();
    expect(loadSemanticHistory(denied, "history", "11111111-1111-4111-8111-111111111111").persistenceAvailable).toBe(false);
    expect(() => saveSemanticHistory(denied, "history", { past: [command(1)], future: [] })).not.toThrow();
    expect(saveSemanticHistory(denied, "history", { past: [command(1)], future: [] })).toBe(false);
  });
});
