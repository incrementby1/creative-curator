import { describe, expect, it, vi } from "vitest";
import { PendingEditStore, classifyPendingFailure, replayPendingEdits, projectGraphPerformanceMode } from "./pending-project-edits";

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

  it("caps UTF-8 payload bytes rather than JavaScript code units", () => {
    const storage = new Map<string, string>(); const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) });
    expect(store.enqueue({ ...edit(), payload: { nodeId: "node-a", input: { title: "é".repeat(33_000), expected_node_version: 2 } } })).toBe(false);
  });

  it("fails closed without overwriting records after transient read failure", () => {
    let raw = ""; let fail = false; const storage = { getItem: () => { if (fail) throw new Error("denied"); return raw || null; }, setItem: (_k: string, value: string) => { raw = value; }, removeItem: () => { raw = ""; } };
    const store = new PendingEditStore(storage); expect(store.enqueue(edit())).toBe(true); const preserved = raw; fail = true;
    expect(store.enqueue(edit("owner-a", "project-a", 2))).toBe(false); expect(raw).toBe(preserved);
    return replayPendingEdits(store, "owner-a", "project-a", vi.fn()).then((result) => expect(result.readFailed).toBe(true));
  });

  it("replays in order, clears successes, and stops at conflict", async () => {
    const storage = new Map<string, string>();
    const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) });
    [1, 2, 3].forEach((i) => store.enqueue(edit("owner-a", "project-a", i)));
    const apply = vi.fn(async (item) => item.expectedVersion === 2 ? "conflict" as const : "success" as const);
    const result = await replayPendingEdits(store, "owner-a", "project-a", apply);
    expect(apply.mock.calls.map(([item]) => item.expectedVersion)).toEqual([1, 2]);
    expect(result).toEqual({ replayed: 1, conflict: expect.objectContaining({ expectedVersion: 2 }), terminal: null, retryableFailure: null, clearFailed: null, readFailed: false });
    expect(store.list("owner-a", "project-a").map((item) => item.expectedVersion)).toEqual([2, 3]);
  });

  it("stops and retains successful server edit when local clear fails", async () => {
    let raw = ""; const storage = { getItem: () => raw || null, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { throw new Error("denied"); } };
    const store = new PendingEditStore(storage); store.enqueue(edit());
    const apply = vi.fn().mockResolvedValue("success");
    expect(await replayPendingEdits(store, "owner-a", "project-a", apply)).toEqual({ replayed: 0, conflict: null, terminal: null, retryableFailure: null, clearFailed: expect.objectContaining({ idempotencyKey: "key-1" }), readFailed: false });
    expect(store.list("owner-a", "project-a")).toHaveLength(1); expect(apply).toHaveBeenCalledOnce();
  });

  it("classifies only temporary failures as queue eligible", () => {
    for (const status of [0, 408, 425, 429, 500, 503]) expect(classifyPendingFailure({ status })).toBe("retryable");
    for (const status of [401, 403, 404, 413, 422]) expect(classifyPendingFailure({ status })).toBe("terminal");
    expect(classifyPendingFailure({ status: 409, code: "version_conflict" })).toBe("conflict");
  });

  it("surfaces and retains terminal and retryable replay failures", async () => {
    const storage = new Map<string, string>(); const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }); store.enqueue(edit());
    const terminal = await replayPendingEdits(store, "owner-a", "project-a", async () => ({ kind: "terminal", status: 422, code: "invalid_request" }));
    expect(terminal.terminal).toEqual({ edit: expect.objectContaining({ idempotencyKey: "key-1" }), status: 422, code: "invalid_request" }); expect(store.list("owner-a", "project-a")).toHaveLength(1);
    const retryable = await replayPendingEdits(store, "owner-a", "project-a", async () => ({ kind: "retryable", status: 503 }));
    expect(retryable.retryableFailure?.status).toBe(503); expect(store.list("owner-a", "project-a")).toHaveLength(1);
  });

  it.each(["discard", "keep-in-tab"])("%s removal unblocks later ordered recovery", async () => {
    const storage = new Map<string, string>(); const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }); store.enqueue(edit("owner-a", "project-a", 1)); store.enqueue(edit("owner-a", "project-a", 2));
    const first = await replayPendingEdits(store, "owner-a", "project-a", async (item) => item.expectedVersion === 1 ? { kind: "terminal" } : { kind: "success" }); expect(first.terminal?.edit.expectedVersion).toBe(1);
    expect(store.remove("owner-a", "project-a", first.terminal!.edit.idempotencyKey)).toBe(true);
    const resumed = await replayPendingEdits(store, "owner-a", "project-a", async () => ({ kind: "success" })); expect(resumed.replayed).toBe(1); expect(store.list("owner-a", "project-a")).toEqual([]);
  });

  it("passes exact stored version and idempotency key to replay callback", async () => {
    const storage = new Map<string, string>(); const store = new PendingEditStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) });
    store.enqueue(edit("owner-a", "project-a", 7)); const apply = vi.fn().mockResolvedValue("conflict");
    await replayPendingEdits(store, "owner-a", "project-a", apply);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7, idempotencyKey: "key-7" }));
  });

  it("enqueues, deserializes, and replays every challenge transition", async () => {
    const storage = new Map<string, string>();
    const storageApi = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) };
    const states = ["acknowledged", "resolved", "deferred", "overridden"] as const;
    const store = new PendingEditStore(storageApi);
    states.forEach((state, index) => expect(store.enqueue({ ...edit(), idempotencyKey: `challenge-${state}`, expectedVersion: index + 1,
      operation: "resolve_challenge", payload: { nodeId: "challenge-a", state, note: `${state} note` }, createdAt: index + 1 })).toBe(true));

    const deserialized = new PendingEditStore(storageApi).list("owner-a", "project-a");
    expect(deserialized.map((item) => item.payload.state)).toEqual(states);
    const apply = vi.fn().mockResolvedValue({ kind: "success" });
    expect((await replayPendingEdits(new PendingEditStore(storageApi), "owner-a", "project-a", apply)).replayed).toBe(4);
    expect(apply.mock.calls.map(([item]) => item.payload.state)).toEqual(states);
    expect(store.list("owner-a", "project-a")).toEqual([]);
  });
});

describe("large graph policy", () => {
  it("collapses distant clusters and simplifies distant nodes for 250 nodes and 400 edges", () => {
    expect(projectGraphPerformanceMode({ nodeCount: 250, edgeCount: 400, zoom: 0.42 })).toEqual({ collapseDistantClusters: true, simplifyDistantNodes: true });
    expect(projectGraphPerformanceMode({ nodeCount: 10, edgeCount: 9, zoom: 1 })).toEqual({ collapseDistantClusters: false, simplifyDistantNodes: false });
  });
});
