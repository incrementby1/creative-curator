import { describe, expect, it, vi } from "vitest";
import type { CanvasAnnotation, GraphNode } from "../../lib/project-types";
import {
  MAX_WORKSPACE_HISTORY,
  commitWorkspaceRedo,
  commitWorkspaceUndo,
  emptyWorkspaceHistory,
  loadWorkspaceHistory,
  recordWorkspaceCommand,
  redoCandidate,
  saveWorkspaceHistory,
  undoCandidate,
  type WorkspaceCommand,
} from "./workspace-history";

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const node = (id = "00000000-0000-4000-8000-000000000001"): GraphNode => ({
  id, project_id: PROJECT_ID, node_type: "idea", title: "Thought", content: "Content",
  state: "working", created_by: "user", provenance: null, tags: [], version: 1,
  created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:00Z",
});
const annotation = (id = "annotation-1"): CanvasAnnotation => ({
  id, project_id: PROJECT_ID, owner_id: OWNER_ID, annotation_type: "freehand",
  path_points: [[0, 0], [1, 1]], color: "#111111", media_id: null, version: 1,
  created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:00Z",
});
const graphCommand: WorkspaceCommand = {
  schemaVersion: 1, ownerId: OWNER_ID, projectId: PROJECT_ID, createdAt: 1,
  action: { domain: "graph", command: { kind: "node", node: node() } },
};
const annotationCommand: WorkspaceCommand = {
  schemaVersion: 1, ownerId: OWNER_ID, projectId: PROJECT_ID, createdAt: 2,
  action: { domain: "annotation", before: [], after: [annotation()] },
};
const command = (index: number): WorkspaceCommand => ({ ...graphCommand, createdAt: index + 1 });

describe("workspace browser history", () => {
  it("undoes and redoes graph and annotation commands in one chronology", () => {
    const history = recordWorkspaceCommand(recordWorkspaceCommand(emptyWorkspaceHistory(), graphCommand), annotationCommand);
    expect(undoCandidate(history)).toEqual(annotationCommand);
    const afterAnnotationUndo = commitWorkspaceUndo(history);
    expect(undoCandidate(afterAnnotationUndo)).toEqual(graphCommand);
    expect(redoCandidate(afterAnnotationUndo)).toEqual(annotationCommand);
    expect(redoCandidate(commitWorkspaceRedo(afterAnnotationUndo))).toBeNull();
  });

  it("keeps candidates active until their successful operation is committed", () => {
    const history = recordWorkspaceCommand(emptyWorkspaceHistory(), annotationCommand);
    expect(undoCandidate(history)).toEqual(annotationCommand);
    expect(undoCandidate(history)).toEqual(annotationCommand);
    expect(redoCandidate(history)).toBeNull();
  });

  it("caps total commands at 50 and clears redo after a new command", () => {
    let history = emptyWorkspaceHistory();
    for (let index = 0; index < 55; index += 1) history = recordWorkspaceCommand(history, command(index));
    expect(history.past).toHaveLength(MAX_WORKSPACE_HISTORY);
    expect(history.past[0].createdAt).toBe(6);
    history = commitWorkspaceUndo(history);
    expect(history.future).toHaveLength(1);
    history = recordWorkspaceCommand(history, annotationCommand);
    expect(history.future).toEqual([]);
    expect(history.past).toHaveLength(MAX_WORKSPACE_HISTORY);
  });

  it("rejects cross-owner, cross-project, malformed annotation, and extra-field payloads", () => {
    const invalid = [
      { ...graphCommand, ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { ...graphCommand, projectId: "22222222-2222-4222-8222-222222222222" },
      { ...annotationCommand, action: { domain: "annotation", before: [], after: [{ ...annotation(), color: 4 }] } },
      { ...graphCommand, unexpected: true },
      { ...graphCommand, action: { ...graphCommand.action, unexpected: true } },
      { ...graphCommand, createdAt: 0 },
    ];
    for (const value of invalid) {
      const storage = { getItem: vi.fn(() => JSON.stringify({ past: [value], future: [] })), removeItem: vi.fn(), setItem: vi.fn() } as unknown as Storage;
      expect(loadWorkspaceHistory(storage, "history", OWNER_ID, PROJECT_ID)).toEqual({ past: [], future: [], persistenceAvailable: false });
      expect(storage.removeItem).toHaveBeenCalledWith("history");
    }
  });

  it("loads valid empty storage and never throws when storage access or cleanup is denied", () => {
    const empty = { getItem: vi.fn(() => null), removeItem: vi.fn(), setItem: vi.fn() } as unknown as Storage;
    expect(loadWorkspaceHistory(empty, "history", OWNER_ID, PROJECT_ID)).toEqual({ past: [], future: [], persistenceAvailable: true });
    const denied = {
      getItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
      setItem: vi.fn(() => { throw new DOMException("full", "QuotaExceededError"); }),
      removeItem: vi.fn(() => { throw new DOMException("denied", "SecurityError"); }),
    } as unknown as Storage;
    expect(() => loadWorkspaceHistory(denied, "history", OWNER_ID, PROJECT_ID)).not.toThrow();
    expect(loadWorkspaceHistory(denied, "history", OWNER_ID, PROJECT_ID).persistenceAvailable).toBe(false);
    expect(() => saveWorkspaceHistory(denied, "history", { past: [graphCommand], future: [] })).not.toThrow();
    expect(saveWorkspaceHistory(denied, "history", { past: [graphCommand], future: [] })).toBe(false);
  });
});
