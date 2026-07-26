export const PENDING_EDIT_SCHEMA_VERSION = 1 as const;
export const PENDING_EDIT_STORAGE_KEY = "creative-curator:pending-project-edits:v1";
export const MAX_PENDING_EDITS_PER_SCOPE = 25;
export const MAX_PENDING_EDIT_PAYLOAD_BYTES = 64 * 1024;

export type PendingOperation = "create_node" | "update_node" | "create_edge" | "delete_edge" | "trash_node" | "restore_node" | "accept_proposal" | "reject_proposal" | "resolve_challenge";
export type PendingProjectEdit = Readonly<{
  schemaVersion: typeof PENDING_EDIT_SCHEMA_VERSION; ownerId: string; projectId: string; idempotencyKey: string;
  expectedVersion: number; operation: PendingOperation; payload: Readonly<Record<string, unknown>>; createdAt: number;
}>;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const operations = new Set<PendingOperation>(["create_node", "update_node", "create_edge", "delete_edge", "trash_node", "restore_node", "accept_proposal", "reject_proposal", "resolve_challenge"]);
const forbidden = /(^|_)(api.?key|provider|prompt|raw|secret|token|credential|ciphertext)($|_)/i;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function validPayload(operation: PendingOperation, payload: unknown): payload is Record<string, unknown> {
  if (!record(payload)) return false;
  if (operation === "create_node") return record(payload.input) && typeof payload.input.title === "string";
  if (operation === "update_node") return typeof payload.nodeId === "string" && record(payload.input) && typeof payload.input.title === "string" && Number.isSafeInteger(payload.input.expected_node_version);
  if (operation === "create_edge") return record(payload.input) && typeof payload.input.source_node_id === "string" && typeof payload.input.target_node_id === "string";
  if (operation === "delete_edge") return typeof payload.edgeId === "string" && Number.isSafeInteger(payload.edgeVersion);
  if (operation === "trash_node" || operation === "restore_node") return typeof payload.nodeId === "string" && Number.isSafeInteger(payload.nodeVersion);
  if (operation === "accept_proposal" || operation === "reject_proposal") return typeof payload.proposalId === "string";
  return typeof payload.nodeId === "string" && ["resolved", "deferred", "overridden"].includes(String(payload.state)) && typeof payload.note === "string";
}

function valid(value: unknown): value is PendingProjectEdit {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.ownerId !== "string" || !item.ownerId || typeof item.projectId !== "string" || !item.projectId
      || typeof item.idempotencyKey !== "string" || !item.idempotencyKey || !Number.isSafeInteger(item.expectedVersion) || Number(item.expectedVersion) < 0
      || !operations.has(item.operation as PendingOperation) || !Number.isFinite(item.createdAt)) return false;
  try {
    const serialized = JSON.stringify(item.payload);
    if (!validPayload(item.operation as PendingOperation, item.payload) || new TextEncoder().encode(serialized).byteLength > MAX_PENDING_EDIT_PAYLOAD_BYTES) return false;
    const walk = (candidate: unknown): boolean => !candidate || typeof candidate !== "object" || Object.entries(candidate).every(([key, nested]) => !forbidden.test(key) && walk(nested));
    return walk(item.payload);
  } catch { return false; }
}

export class PendingEditStore {
  constructor(private readonly storage: StorageLike | null, private readonly limit = MAX_PENDING_EDITS_PER_SCOPE) {}
  private read(): PendingProjectEdit[] | null {
    if (!this.storage) return null;
    try { const raw = this.storage.getItem(PENDING_EDIT_STORAGE_KEY); if (raw === null) return []; const value: unknown = JSON.parse(raw); return Array.isArray(value) ? value.filter(valid) : []; }
    catch { return null; }
  }
  private write(items: readonly PendingProjectEdit[]): boolean {
    if (!this.storage) return false;
    try { if (items.length) this.storage.setItem(PENDING_EDIT_STORAGE_KEY, JSON.stringify(items)); else this.storage.removeItem(PENDING_EDIT_STORAGE_KEY); return true; }
    catch { return false; }
  }
  load(ownerId: string, projectId: string): { ok: boolean; items: PendingProjectEdit[] } { const items = this.read(); return items === null ? { ok: false, items: [] } : { ok: true, items: items.filter((item) => item.ownerId === ownerId && item.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt) }; }
  list(ownerId: string, projectId: string): PendingProjectEdit[] { return this.load(ownerId, projectId).items; }
  enqueue(item: PendingProjectEdit): boolean {
    if (!valid(item)) return false;
    const loaded = this.read(); if (loaded === null) return false;
    const other = loaded.filter((candidate) => candidate.ownerId !== item.ownerId || candidate.projectId !== item.projectId);
    const scoped = loaded.filter((candidate) => candidate.ownerId === item.ownerId && candidate.projectId === item.projectId && candidate.idempotencyKey !== item.idempotencyKey).sort((a, b) => a.createdAt - b.createdAt);
    return this.write([...other, ...[...scoped, item].slice(-this.limit)]);
  }
  remove(ownerId: string, projectId: string, idempotencyKey: string): boolean { const items = this.read(); return items !== null && this.write(items.filter((item) => item.ownerId !== ownerId || item.projectId !== projectId || item.idempotencyKey !== idempotencyKey)); }
}

export async function replayPendingEdits(store: PendingEditStore, ownerId: string, projectId: string, apply: (edit: PendingProjectEdit) => Promise<"success" | "conflict">) {
  let replayed = 0;
  const loaded = store.load(ownerId, projectId); if (!loaded.ok) return { replayed: 0, conflict: null, clearFailed: null, readFailed: true };
  for (const edit of loaded.items) {
    let result: "success" | "conflict";
    try { result = await apply(edit); } catch { break; }
    if (result === "conflict") return { replayed, conflict: edit, clearFailed: null, readFailed: false };
    if (!store.remove(ownerId, projectId, edit.idempotencyKey)) return { replayed, conflict: null, clearFailed: edit, readFailed: false };
    replayed += 1;
  }
  return { replayed, conflict: null, clearFailed: null, readFailed: false };
}

export function projectGraphPerformanceMode(input: { nodeCount: number; edgeCount: number; zoom: number }) {
  const large = input.nodeCount >= 250 || input.edgeCount >= 400;
  return { collapseDistantClusters: large && input.zoom < .5, simplifyDistantNodes: large && input.zoom < .65 };
}
