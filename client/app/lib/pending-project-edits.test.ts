import { describe, expect, it, vi } from "vitest";
import { PendingEditStore, replayPendingEdits, projectGraphPerformanceMode } from "./pending-project-edits";

const edit = (owner = "owner-a", project = "project-a", index = 1) => ({
  schemaVersion: 1 as const, ownerId: owner, projectId: project, idempotencyKey: `key-${index}`,
  expectedVersion: index, operation: "update_node" as const,
  payload: { nodeId: "node-a", input: { title: `Title ${index}`, content: "Exact submitted value", expected_node_version: 2 } }, createdAt: index,
});

describe("PendingEditStore", () => {
  it("bounds and scopes queued semantic edits by authenticated owner and project", () => {
    const storage = new Map<string, string>();
    const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }, 2);
    expect(store.enqueue(edit("owner-a", "project-a", 1))).toBe(true);
    expect(store.enqueue(edit("owner-a", "project-a", 2))).toBe(true);
    expect(store.enqueue(edit("owner-a", "project-a", 3))).toBe(true);
    store.enqueue(edit("owner-b", "project-a", 4));
    expect(store.list("owner-a", "project-a").map((item) => item.idempotencyKey)).toEqual(["key-2", "key-3"]);
    expect(store.list("owner-b", "project-a")).toHaveLength(1);
  });

  it("rejects malformed, oversized, secret-bearing, and unavailable-storage writes safely", () => {
    const denied = new PendingEditStore({ getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => undefined });
    expect(denied.enqueue(edit())).toBe(false);
    const storage = new Map<string, string>();
    const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) });
    expect(store.enqueue({ ...edit(), payload: { apiKey: "secret" } })).toBe(false);
    expect(store.enqueue({ ...edit(), payload: { content: "x".repeat(70_000) } })).toBe(false);
    storage.set("creative-curator:pending-project-edits:v1", "broken-json");
    expect(store.list("owner-a", "project-a")).toEqual([]);
  });

  it("replays in order, clears successes, and stops at conflict", async () => {
    const storage = new Map<string, string>();
    const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) });
    [1, 2, 3].forEach((i) => store.enqueue(edit("owner-a", "project-a", i)));
    const apply = vi.fn(async (item) => item.expectedVersion === 2 ? "conflict" as const : "success" as const);
    const result = await replayPendingEdits(store, "owner-a", "project-a", apply);
    expect(apply.mock.calls.map(([item]) => item.expectedVersion)).toEqual([1, 2]);
    expect(result).toEqual({ replayed: 1, conflict: expect.objectContaining({ expectedVersion: 2 }), clearFailed: null });
    expect(store.list("owner-a", "project-a").map((item) => item.expectedVersion)).toEqual([2, 3]);
  });

  it("stops and retains successful server edit when local clear fails", async () => {
    let raw = ""; const storage = { getItem: () => raw || null, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { throw new Error("denied"); } };
    const store = new PendingEditStore(storage); store.enqueue(edit());
    const apply = vi.fn().mockResolvedValue("success");
    expect(await replayPendingEdits(store, "owner-a", "project-a", apply)).toEqual({ replayed: 0, conflict: null, clearFailed: expect.objectContaining({ idempotencyKey: "key-1" }) });
    expect(store.list("owner-a", "project-a")).toHaveLength(1); expect(apply).toHaveBeenCalledOnce();
  });

  it("passes exact stored version and idempotency key to replay callback", async () => {
    const storage = new Map<string, string>(); const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) });
    store.enqueue(edit("owner-a", "project-a", 7)); const apply = vi.fn().mockResolvedValue("conflict");
    await replayPendingEdits(store, "owner-a", "project-a", apply);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7, idempotencyKey: "key-7" }));
  });
});

describe("large graph policy", () => {
  it("collapses distant clusters and simplifies distant nodes for 250 nodes and 400 edges", () => {
    expect(projectGraphPerformanceMode({ nodeCount: 250, edgeCount: 400, zoom: 0.42 })).toEqual({ collapseDistantClusters: true, simplifyDistantNodes: true });
    expect(projectGraphPerformanceMode({ nodeCount: 10, edgeCount: 9, zoom: 1 })).toEqual({ collapseDistantClusters: false, simplifyDistantNodes: false });
  });
});
