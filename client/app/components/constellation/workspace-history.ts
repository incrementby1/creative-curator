import type { CanvasAnnotation, GraphEdge, GraphNode } from "../../lib/project-types";

export const MAX_WORKSPACE_HISTORY = 50;
export const MAX_WORKSPACE_HISTORY_BYTES = 2 * 1024 * 1024;
const MAX_ANNOTATIONS_PER_SNAPSHOT = 500;
const MAX_POINTS_PER_ANNOTATION = 10_000;
const MAX_POINTS_PER_SNAPSHOT = 50_000;

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

export function annotationSnapshotsEqual(left: readonly CanvasAnnotation[], right: readonly CanvasAnnotation[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return Boolean(other) && item.id === other.id && item.project_id === other.project_id && item.owner_id === other.owner_id &&
      item.annotation_type === other.annotation_type && item.color === other.color && item.media_id === other.media_id &&
      item.version === other.version && item.created_at === other.created_at && item.updated_at === other.updated_at &&
      item.path_points.length === other.path_points.length && item.path_points.every((point, pointIndex) =>
        point[0] === other.path_points[pointIndex]?.[0] && point[1] === other.path_points[pointIndex]?.[1]);
  });
}

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
  if (!(text(value.id) && UUID.test(value.id) && value.project_id === projectId && value.owner_id === ownerId &&
    text(value.annotation_type) && ANNOTATION_TYPES.has(value.annotation_type) && Array.isArray(value.path_points) &&
    value.path_points.length <= MAX_POINTS_PER_ANNOTATION &&
    value.path_points.every((point) => Array.isArray(point) && point.length === 2 && point.every(finiteNumber)) &&
    nullableText(value.color) && (value.color === null || (value.color.length >= 1 && value.color.length <= 64)) &&
    nullableText(value.media_id) && positiveInteger(value.version) && timestamp(value.created_at) && timestamp(value.updated_at))) return false;
  if (value.annotation_type === "freehand") return value.path_points.length >= 2 && value.media_id === null;
  return value.path_points.length === 0 && value.color === null && text(value.media_id) && UUID.test(value.media_id);
}

function validAnnotationSnapshot(value: unknown[], ownerId: string, projectId: string): value is CanvasAnnotation[] {
  if (value.length > MAX_ANNOTATIONS_PER_SNAPSHOT) return false;
  let points = 0;
  const ids = new Set<string>();
  for (const item of value) {
    if (!validAnnotation(item, ownerId, projectId)) return false;
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    points += item.path_points.length;
    if (points > MAX_POINTS_PER_SNAPSHOT) return false;
  }
  return true;
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
    return validAnnotationSnapshot(action.before, ownerId, projectId) && validAnnotationSnapshot(action.after, ownerId, projectId);
  }
  return false;
}

function safelyRemove(storage: Storage, key: string) {
  try { storage.removeItem(key); } catch { /* browser persistence is optional */ }
}

function withinByteLimit(value: string): boolean {
  return value.length <= MAX_WORKSPACE_HISTORY_BYTES && new TextEncoder().encode(value).byteLength <= MAX_WORKSPACE_HISTORY_BYTES;
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
    if (!withinByteLimit(raw)) throw new Error("Workspace history exceeds persistence limit");
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
    const remaining = MAX_WORKSPACE_HISTORY - past.length;
    const future = remaining === 0 ? [] : history.future.slice(-remaining);
    const serialized = JSON.stringify({ past, future });
    if (!withinByteLimit(serialized)) throw new Error("Workspace history exceeds persistence limit");
    storage.setItem(key, serialized);
    return true;
  } catch {
    safelyRemove(storage, key);
    return false;
  }
}
