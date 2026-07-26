export const PENDING_EDIT_SCHEMA_VERSION = 1 as const;
export const PENDING_EDIT_STORAGE_KEY = "creative-curator:pending-project-edits:v1";
export const MAX_PENDING_EDITS_PER_SCOPE = 25;
export const MAX_PENDING_EDIT_PAYLOAD_BYTES = 64 * 1024;

export type PendingOperation = "create_node" | "update_node" | "create_edge" | "accept_proposal" | "resolve_challenge";
export type PendingProjectEdit = Readonly<{
  schemaVersion: typeof PENDING_EDIT_SCHEMA_VERSION; ownerId: string; projectId: string; idempotencyKey: string;
  expectedVersion: number; operation: PendingOperation; payload: Readonly<Record<string, unknown>>; createdAt: number;
}>;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const operations = new Set<PendingOperation>(["create_node", "update_node", "create_edge", "accept_proposal", "resolve_challenge"]);
const forbidden = /(^|_)(api.?key|provider|prompt|raw|secret|token|credential|ciphertext)($|_)/i;

function valid(value: unknown): value is PendingProjectEdit {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.ownerId !== "string" || !item.ownerId || typeof item.projectId !== "string" || !item.projectId
      || typeof item.idempotencyKey !== "string" || !item.idempotencyKey || !Number.isSafeInteger(item.expectedVersion) || Number(item.expectedVersion) < 0
      || !operations.has(item.operation as PendingOperation) || !Number.isFinite(item.createdAt)) return false;
  try {
    const serialized = JSON.stringify(item.payload);
    if (!item.payload || typeof item.payload !== "object" || serialized.length > MAX_PENDING_EDIT_PAYLOAD_BYTES) return false;
    const walk = (candidate: unknown): boolean => !candidate || typeof candidate !== "object" || Object.entries(candidate).every(([key, nested]) => !forbidden.test(key) && walk(nested));
    return walk(item.payload);
  } catch { return false; }
}

export class PendingEditStore {
  constructor(private readonly storage: StorageLike | null, private readonly limit = MAX_PENDING_EDITS_PER_SCOPE) {}
  private read(): PendingProjectEdit[] {
    if (!this.storage) return [];
    try { const value: unknown = JSON.parse(this.storage.getItem(PENDING_EDIT_STORAGE_KEY) ?? "[]"); return Array.isArray(value) ? value.filter(valid) : []; }
    catch { return []; }
  }
  private write(items: readonly PendingProjectEdit[]): boolean {
    if (!this.storage) return false;
    try { if (items.length) this.storage.setItem(PENDING_EDIT_STORAGE_KEY, JSON.stringify(items)); else this.storage.removeItem(PENDING_EDIT_STORAGE_KEY); return true; }
    catch { return false; }
  }
  list(ownerId: string, projectId: string): PendingProjectEdit[] { return this.read().filter((item) => item.ownerId === ownerId && item.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt); }
  enqueue(item: PendingProjectEdit): boolean {
    if (!valid(item)) return false;
    const other = this.read().filter((candidate) => candidate.ownerId !== item.ownerId || candidate.projectId !== item.projectId);
    const scoped = this.list(item.ownerId, item.projectId).filter((candidate) => candidate.idempotencyKey !== item.idempotencyKey);
    return this.write([...other, ...[...scoped, item].slice(-this.limit)]);
  }
  remove(ownerId: string, projectId: string, idempotencyKey: string): boolean { return this.write(this.read().filter((item) => item.ownerId !== ownerId || item.projectId !== projectId || item.idempotencyKey !== idempotencyKey)); }
}

export async function replayPendingEdits(store: PendingEditStore, ownerId: string, projectId: string, apply: (edit: PendingProjectEdit) => Promise<"success" | "conflict">) {
  let replayed = 0;
  for (const edit of store.list(ownerId, projectId)) {
    let result: "success" | "conflict";
    try { result = await apply(edit); } catch { break; }
    if (result === "conflict") return { replayed, conflict: edit };
    store.remove(ownerId, projectId, edit.idempotencyKey); replayed += 1;
  }
  return { replayed, conflict: null };
}

export function projectGraphPerformanceMode(input: { nodeCount: number; edgeCount: number; zoom: number }) {
  const large = input.nodeCount >= 250 || input.edgeCount >= 400;
  return { collapseDistantClusters: large && input.zoom < .5, simplifyDistantNodes: large && input.zoom < .65 };
}
