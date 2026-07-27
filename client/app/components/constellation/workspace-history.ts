import type { CanvasAnnotation, GraphEdge, GraphNode } from "../../lib/project-types";

export const MAX_WORKSPACE_HISTORY = 50;

export type SemanticCommand =
  | Readonly<{ kind: "node"; node: GraphNode }>
  | Readonly<{ kind: "edge"; edge: GraphEdge }>;

export type WorkspaceCommand = Readonly<{
  schemaVersion: 1;
  ownerId: string;
  projectId: string;
  createdAt: number;
  action:
    | Readonly<{ domain: "graph"; command: SemanticCommand }>
    | Readonly<{ domain: "annotation"; before: readonly CanvasAnnotation[]; after: readonly CanvasAnnotation[] }>;
}>;

export type WorkspaceHistory = Readonly<{
  past: readonly WorkspaceCommand[];
  future: readonly WorkspaceCommand[];
}>;

export type LoadedWorkspaceHistory = WorkspaceHistory & Readonly<{ persistenceAvailable: boolean }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NODE_TYPES = new Set(["evidence", "assumption", "idea", "decision", "challenge", "output"]);
const NODE_STATES = new Set(["working", "approved", "review_suggested", "trash"]);
const CREATION_SOURCES = new Set(["user", "hermes", "import"]);
const EDGE_TYPES = new Set(["supports", "contradicts", "depends_on", "inspires", "supersedes"]);
const ANNOTATION_TYPES = new Set(["freehand", "media"]);
const NODE_REQUIRED_KEYS = ["id", "project_id", "node_type", "title", "content", "state", "created_by", "provenance", "tags", "version", "created_at", "updated_at"];
const NODE_OPTIONAL_KEYS = ["challenge_dependencies", "challenge_confidence", "challenge_downstream_effect"];
const EDGE_KEYS = ["id", "project_id", "source_node_id", "target_node_id", "edge_type", "label", "version", "created_at", "updated_at"];
const ANNOTATION_KEYS = ["id", "project_id", "owner_id", "annotation_type", "path_points", "color", "media_id", "version", "created_at", "updated_at"];

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && expected.every((key, index) => key === actual[index]);
};
const requiredAndOptionalKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[]) => {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
};
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const positiveInteger = (value: unknown) => Number.isInteger(value) && Number(value) >= 1;
const timestamp = (value: unknown): value is string => text(value) && value.length > 0 && Number.isFinite(Date.parse(value));
const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validNode(value: unknown, projectId: string): value is GraphNode {
  if (!record(value) || !requiredAndOptionalKeys(value, NODE_REQUIRED_KEYS, NODE_OPTIONAL_KEYS)) return false;
  return text(value.id) && UUID.test(value.id) && value.project_id === projectId &&
    text(value.node_type) && NODE_TYPES.has(value.node_type) && text(value.title) && text(value.content) &&
    text(value.state) && NODE_STATES.has(value.state) && text(value.created_by) && CREATION_SOURCES.has(value.created_by) &&
    nullableText(value.provenance) && Array.isArray(value.tags) && value.tags.every(text) &&
    (value.challenge_dependencies === undefined || (Array.isArray(value.challenge_dependencies) && value.challenge_dependencies.every(text))) &&
    (value.challenge_confidence === undefined || value.challenge_confidence === null || (Number.isInteger(value.challenge_confidence) && Number(value.challenge_confidence) >= 0 && Number(value.challenge_confidence) <= 100)) &&
    (value.challenge_downstream_effect === undefined || nullableText(value.challenge_downstream_effect)) &&
    positiveInteger(value.version) && timestamp(value.created_at) && timestamp(value.updated_at);
}

function validEdge(value: unknown, projectId: string): value is GraphEdge {
  if (!record(value) || !exactKeys(value, EDGE_KEYS)) return false;
  return text(value.id) && UUID.test(value.id) && value.project_id === projectId &&
    text(value.source_node_id) && UUID.test(value.source_node_id) && text(value.target_node_id) && UUID.test(value.target_node_id) &&
    value.source_node_id !== value.target_node_id && text(value.edge_type) && EDGE_TYPES.has(value.edge_type) &&
    nullableText(value.label) && positiveInteger(value.version) && timestamp(value.created_at) && timestamp(value.updated_at);
}

function validAnnotation(value: unknown, ownerId: string, projectId: string): value is CanvasAnnotation {
  if (!record(value) || !exactKeys(value, ANNOTATION_KEYS)) return false;
  return text(value.id) && value.id.length > 0 && value.project_id === projectId && value.owner_id === ownerId &&
    text(value.annotation_type) && ANNOTATION_TYPES.has(value.annotation_type) && Array.isArray(value.path_points) &&
    value.path_points.every((point) => Array.isArray(point) && point.length === 2 && point.every(finiteNumber)) &&
    nullableText(value.color) && nullableText(value.media_id) && positiveInteger(value.version) &&
    timestamp(value.created_at) && timestamp(value.updated_at);
}

function validSemanticCommand(value: unknown, projectId: string): value is SemanticCommand {
  if (!record(value)) return false;
  if (value.kind === "node" && exactKeys(value, ["kind", "node"])) return validNode(value.node, projectId);
  if (value.kind === "edge" && exactKeys(value, ["kind", "edge"])) return validEdge(value.edge, projectId);
  return false;
}

function validWorkspaceCommand(value: unknown, ownerId: string, projectId: string): value is WorkspaceCommand {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "ownerId", "projectId", "createdAt", "action"]) ||
      value.schemaVersion !== 1 || value.ownerId !== ownerId || value.projectId !== projectId ||
      !finiteNumber(value.createdAt) || value.createdAt <= 0 || !record(value.action)) return false;
  const action = value.action;
  if (action.domain === "graph" && exactKeys(action, ["domain", "command"])) return validSemanticCommand(action.command, projectId);
  if (action.domain === "annotation" && exactKeys(action, ["domain", "before", "after"]) && Array.isArray(action.before) && Array.isArray(action.after)) {
    return action.before.every((item) => validAnnotation(item, ownerId, projectId)) && action.after.every((item) => validAnnotation(item, ownerId, projectId));
  }
  return false;
}

function safelyRemove(storage: Storage, key: string) {
  try { storage.removeItem(key); } catch { /* browser persistence is optional */ }
}

export function emptyWorkspaceHistory(): WorkspaceHistory {
  return { past: [], future: [] };
}

export function recordWorkspaceCommand(history: WorkspaceHistory, command: WorkspaceCommand): WorkspaceHistory {
  return { past: [...history.past, command].slice(-MAX_WORKSPACE_HISTORY), future: [] };
}

export const undoCandidate = (history: WorkspaceHistory): WorkspaceCommand | null => history.past.at(-1) ?? null;
export const redoCandidate = (history: WorkspaceHistory): WorkspaceCommand | null => history.future.at(-1) ?? null;

export function commitWorkspaceUndo(history: WorkspaceHistory): WorkspaceHistory {
  const candidate = undoCandidate(history);
  return candidate ? { past: history.past.slice(0, -1), future: [...history.future, candidate] } : history;
}

export function commitWorkspaceRedo(history: WorkspaceHistory): WorkspaceHistory {
  const candidate = redoCandidate(history);
  return candidate ? { past: [...history.past, candidate], future: history.future.slice(0, -1) } : history;
}

export function loadWorkspaceHistory(storage: Storage | null, key: string, ownerId: string, projectId: string): LoadedWorkspaceHistory {
  if (!storage) return { past: [], future: [], persistenceAvailable: false };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { past: [], future: [], persistenceAvailable: true };
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed) || !exactKeys(parsed, ["past", "future"]) || !Array.isArray(parsed.past) || !Array.isArray(parsed.future) ||
        parsed.past.length + parsed.future.length > MAX_WORKSPACE_HISTORY ||
        !parsed.past.every((item) => validWorkspaceCommand(item, ownerId, projectId)) ||
        !parsed.future.every((item) => validWorkspaceCommand(item, ownerId, projectId))) throw new Error("Invalid workspace history");
    return { past: parsed.past, future: parsed.future, persistenceAvailable: true };
  } catch {
    safelyRemove(storage, key);
    return { past: [], future: [], persistenceAvailable: false };
  }
}

export function saveWorkspaceHistory(storage: Storage | null, key: string, history: WorkspaceHistory): boolean {
  if (!storage) return false;
  try {
    const past = history.past.slice(-MAX_WORKSPACE_HISTORY);
    const future = history.future.slice(-(MAX_WORKSPACE_HISTORY - past.length));
    storage.setItem(key, JSON.stringify({ past, future }));
    return true;
  } catch {
    safelyRemove(storage, key);
    return false;
  }
}

// Temporary graph-only adapter for ConstellationEditor. Task 4 replaces these calls
// with WorkspaceHistory coordination across graph and annotation persistence queues.
type SemanticHistory = { past: SemanticCommand[]; future: SemanticCommand[] };
export function boundSemanticHistory(history: SemanticHistory): SemanticHistory {
  const past = history.past.slice(-MAX_WORKSPACE_HISTORY);
  return { past, future: history.future.slice(-(MAX_WORKSPACE_HISTORY - past.length)) };
}
export function loadSemanticHistory(storage: Storage | null, key: string, projectId: string): SemanticHistory & Readonly<{ persistenceAvailable: boolean }> {
  if (!storage) return { past: [], future: [], persistenceAvailable: false };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { past: [], future: [], persistenceAvailable: true };
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed) || !exactKeys(parsed, ["past", "future"]) || !Array.isArray(parsed.past) || !Array.isArray(parsed.future) ||
        parsed.past.length + parsed.future.length > MAX_WORKSPACE_HISTORY ||
        !parsed.past.every((item) => validSemanticCommand(item, projectId)) ||
        !parsed.future.every((item) => validSemanticCommand(item, projectId))) throw new Error("Invalid semantic history");
    return { past: parsed.past as SemanticCommand[], future: parsed.future as SemanticCommand[], persistenceAvailable: true };
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
