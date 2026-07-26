import type { GraphEdge, GraphNode } from "../../lib/project-types";

export const MAX_SEMANTIC_HISTORY = 50;
export type SemanticCommand = { kind: "node"; node: GraphNode } | { kind: "edge"; edge: GraphEdge };
type SemanticHistory = { past: SemanticCommand[]; future: SemanticCommand[] };
export type LoadedSemanticHistory = SemanticHistory & { persistenceAvailable: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NODE_TYPES = new Set(["evidence", "assumption", "idea", "decision", "challenge", "output"]);
const NODE_STATES = new Set(["working", "approved", "review_suggested", "trash"]);
const CREATION_SOURCES = new Set(["user", "hermes", "import"]);
const EDGE_TYPES = new Set(["supports", "contradicts", "depends_on", "inspires", "supersedes"]);
const LEGACY_NODE_KEYS = ["id", "project_id", "node_type", "title", "content", "state", "created_by", "provenance", "tags", "version", "created_at", "updated_at"];
const NODE_KEYS = [...LEGACY_NODE_KEYS, "challenge_dependencies", "challenge_confidence", "challenge_downstream_effect"];
const EDGE_KEYS = ["id", "project_id", "source_node_id", "target_node_id", "edge_type", "label", "version", "created_at", "updated_at"];

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
};
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const version = (value: unknown) => Number.isInteger(value) && Number(value) >= 1;
const timestamp = (value: unknown): value is string => text(value) && value.length > 0 && Number.isFinite(Date.parse(value));

function validNode(value: unknown, projectId: string): value is GraphNode {
  if (!record(value) || (!exactKeys(value, NODE_KEYS) && !exactKeys(value, LEGACY_NODE_KEYS))) return false;
  return text(value.id) && UUID.test(value.id) && value.project_id === projectId &&
    text(value.node_type) && NODE_TYPES.has(value.node_type) && text(value.title) && text(value.content) &&
    text(value.state) && NODE_STATES.has(value.state) && text(value.created_by) && CREATION_SOURCES.has(value.created_by) &&
    nullableText(value.provenance) && Array.isArray(value.tags) && value.tags.every(text) &&
    (value.challenge_dependencies === undefined || (Array.isArray(value.challenge_dependencies) && value.challenge_dependencies.every(text))) &&
    (value.challenge_confidence === undefined || value.challenge_confidence === null || (Number.isInteger(value.challenge_confidence) && Number(value.challenge_confidence) >= 0 && Number(value.challenge_confidence) <= 100)) &&
    (value.challenge_downstream_effect === undefined || nullableText(value.challenge_downstream_effect)) &&
    version(value.version) && timestamp(value.created_at) && timestamp(value.updated_at);
}

function validEdge(value: unknown, projectId: string): value is GraphEdge {
  if (!record(value) || !exactKeys(value, EDGE_KEYS)) return false;
  return text(value.id) && UUID.test(value.id) && value.project_id === projectId &&
    text(value.source_node_id) && UUID.test(value.source_node_id) && text(value.target_node_id) && UUID.test(value.target_node_id) &&
    value.source_node_id !== value.target_node_id && text(value.edge_type) && EDGE_TYPES.has(value.edge_type) &&
    nullableText(value.label) && version(value.version) && timestamp(value.created_at) && timestamp(value.updated_at);
}

function validCommand(value: unknown, projectId: string): value is SemanticCommand {
  if (!record(value) || !exactKeys(value, value.kind === "node" ? ["kind", "node"] : value.kind === "edge" ? ["kind", "edge"] : [])) return false;
  return value.kind === "node" ? validNode(value.node, projectId) : value.kind === "edge" && validEdge(value.edge, projectId);
}

function safelyRemove(storage: Storage, key: string) {
  try { storage.removeItem(key); } catch { /* browser persistence is optional */ }
}

export function boundSemanticHistory(history: SemanticHistory): SemanticHistory {
  const past = history.past.slice(-MAX_SEMANTIC_HISTORY);
  return { past, future: history.future.slice(-(MAX_SEMANTIC_HISTORY - past.length)) };
}

export function loadSemanticHistory(storage: Storage | null, key: string, projectId: string): LoadedSemanticHistory {
  if (!storage) return { past: [], future: [], persistenceAvailable: false };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { past: [], future: [], persistenceAvailable: true };
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed) || !exactKeys(parsed, ["past", "future"]) || !Array.isArray(parsed.past) || !Array.isArray(parsed.future) ||
      parsed.past.length + parsed.future.length > MAX_SEMANTIC_HISTORY ||
      !parsed.past.every((item) => validCommand(item, projectId)) || !parsed.future.every((item) => validCommand(item, projectId))) throw new Error("Invalid semantic history");
    return { past: parsed.past, future: parsed.future, persistenceAvailable: true };
  } catch {
    safelyRemove(storage, key);
    return { past: [], future: [], persistenceAvailable: false };
  }
}

export function saveSemanticHistory(storage: Storage | null, key: string, history: SemanticHistory): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(boundSemanticHistory(history)));
    return true;
  } catch {
    safelyRemove(storage, key);
    return false;
  }
}
