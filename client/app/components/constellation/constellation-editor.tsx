"use client";

import "@xyflow/react/dist/style.css";
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, applyNodeChanges,
  type Connection, type Edge, type Node, type NodeChange, type OnSelectionChangeParams, type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuth } from "../auth/auth-provider";
import { createAnnotationState, reduceAnnotationAction } from "../../lib/project-annotations";
import { createGraphState, quickCapture, replaceSemantic } from "../../lib/project-graph";
import { createProjectsApi } from "../../lib/projects-api";
import type { CanvasAnnotation, EdgeType, GraphEdge, GraphNode, NodeType, ProjectGraph } from "../../lib/project-types";
import { AnnotationLayer, type CanvasMode, type Viewport } from "./annotation-layer";
import { CanvasToolbar } from "./canvas-toolbar";
import { brandNodeTypes } from "./nodes/brand-node";
import { semanticEdgeTypes } from "./edges/semantic-edge";
import { ProjectMapPanel } from "./project-map-panel";
import { MediaAnnotation } from "./media-annotation";
import type { MediaObjectUrl } from "../../lib/projects-api";

const ALL_TYPES: NodeType[] = ["evidence", "assumption", "idea", "decision", "challenge", "output"];
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const ARIA_LABELS = {
  "node.a11yDescription.default": "Press Enter to select a brand node. Use arrow keys to move it.",
  "node.a11yDescription.keyboardDisabled": "Brand node keyboard movement is disabled.",
  "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }: { direction: string; x: number; y: number }) => `Moved ${direction} to ${x}, ${y}`,
  "edge.a11yDescription.default": "Press Enter to select a semantic relationship.",
  "controls.ariaLabel": "Constellation viewport controls", "controls.zoomIn.ariaLabel": "Zoom in",
  "controls.zoomOut.ariaLabel": "Zoom out", "controls.fitView.ariaLabel": "Fit graph",
  "controls.interactive.ariaLabel": "Toggle graph interactivity", "minimap.ariaLabel": "Constellation minimap",
  "handle.ariaLabel": "Relationship handle",
};

type SaveState = "saved" | "saving" | "attention";
type SemanticCommand = { kind: "node"; node: GraphNode } | { kind: "edge"; edge: GraphEdge };
type EditorProps = { initial: ProjectGraph };
function PersistedMedia({ index, mediaId, resolve }: { index: number; mediaId: string; resolve: (mediaId: string) => Promise<MediaObjectUrl> }) {
  const load = useCallback(() => resolve(mediaId), [mediaId, resolve]);
  return <div className="media-annotation" style={{ left: 80 + (index % 3) * 220, top: 110 + Math.floor(index / 3) * 170 }}>
    <MediaAnnotation alt={`Canvas media ${index + 1}`} load={load} />
  </div>;
}
const layoutStatus = (state: SaveState) => state === "saving" ? "Saving layout…" : state === "attention" ? "Layout needs attention" : "Layout saved";
const annotationStatus = (state: SaveState) => state === "saving" ? "Saving annotations…" : state === "attention" ? "Annotations need attention" : "Annotations saved";
const semanticStatus = (state: SaveState) => state === "saving" ? "Saving graph…" : state === "attention" ? "Graph needs attention" : "Graph saved";
const tags = (nodes: readonly GraphNode[], prefix: string) => [...new Set(nodes.flatMap((node) => node.tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length))))].sort();

function initialPosition(graph: ProjectGraph, node: GraphNode, index: number) {
  const saved = graph.layout[node.id];
  return saved ? { x: saved[0], y: saved[1] } : { x: 80 + (index % 3) * 292, y: 80 + Math.floor(index / 3) * 184 };
}

function toFlowNode(graph: ProjectGraph, record: GraphNode, index: number): Node {
  const dimensions = graph.layout_dimensions[record.id] ?? [244, 124];
  return { id: record.id, type: "brand", position: initialPosition(graph, record, index), data: { record }, style: { width: dimensions[0], height: dimensions[1] } };
}
function toFlowEdge(record: GraphEdge): Edge {
  return { id: record.id, source: record.source_node_id, target: record.target_node_id, type: "semantic", data: { edgeType: record.edge_type, label: record.label } };
}

export function ConstellationEditor({ initial }: EditorProps) {
  return <ReactFlowProvider><ConstellationEditorInner initial={initial} /></ReactFlowProvider>;
}

function ConstellationEditorInner({ initial }: EditorProps) {
  const { client, user } = useAuth();
  const api = useMemo(() => createProjectsApi(client ?? undefined), [client]);
  const liveInitialNodes = useMemo(() => initial.nodes.filter((node) => node.state !== "trash"), [initial.nodes]);
  const liveInitialIds = useMemo(() => new Set(liveInitialNodes.map((node) => node.id)), [liveInitialNodes]);
  const liveInitialEdges = useMemo(() => initial.edges.filter((edge) => liveInitialIds.has(edge.source_node_id) && liveInitialIds.has(edge.target_node_id)), [initial.edges, liveInitialIds]);
  const [graph, setGraph] = useState(() => createGraphState(liveInitialNodes, liveInitialEdges));
  const [flowNodes, setFlowNodes] = useState<Node[]>(() => liveInitialNodes.map((node, index) => toFlowNode(initial, node, index)));
  const [mode, setMode] = useState<CanvasMode>("select");
  const [activeTypes, setActiveTypes] = useState<Set<NodeType>>(() => new Set(ALL_TYPES));
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [viewport, setViewportState] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [layoutSave, setLayoutSave] = useState<SaveState>("saved");
  const [annotationSave, setAnnotationSave] = useState<SaveState>("saved");
  const [semanticSave, setSemanticSave] = useState<SaveState>("saved");
  const [semanticError, setSemanticError] = useState("");
  const [annotations, annotationDispatch] = useReducer(reduceAnnotationAction, createAnnotationState(initial.annotations));
  const [currentPoints, setCurrentPoints] = useState<readonly (readonly [number, number])[]>([]);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutGeneration = useRef(0);
  const layoutVersionRef = useRef(initial.layout_version);
  const layoutQueue = useRef<Promise<void>>(Promise.resolve());
  const persistedNodeIds = useRef(new Set(initial.nodes.map((node) => node.id)));
  const annotationVersionRef = useRef(initial.annotation_version);
  const annotationQueue = useRef<Promise<void>>(Promise.resolve());
  const annotationGeneration = useRef(0);
  const projectVersionRef = useRef(initial.project.version);
  const semanticQueue = useRef<Promise<void>>(Promise.resolve());
  const semanticGeneration = useRef(0);
  const semanticPast = useRef<SemanticCommand[]>([]);
  const semanticFuture = useRef<SemanticCommand[]>([]);
  const semanticHistoryKey = `creative-curator:semantic-history:${initial.project.id}`;
  const persistSemanticHistory = useCallback(() => localStorage.setItem(semanticHistoryKey, JSON.stringify({
    past: semanticPast.current, future: semanticFuture.current,
  })), [semanticHistoryKey]);

  useEffect(() => () => { if (layoutTimer.current) clearTimeout(layoutTimer.current); }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(semanticHistoryKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { past?: SemanticCommand[]; future?: SemanticCommand[] };
      semanticPast.current = Array.isArray(parsed.past) ? parsed.past : [];
      semanticFuture.current = Array.isArray(parsed.future) ? parsed.future : [];
    } catch { localStorage.removeItem(semanticHistoryKey); }
  }, [semanticHistoryKey]);
  useEffect(() => {
    const saved = localStorage.getItem(`creative-curator:viewport:${initial.project.id}`);
    if (!saved) return;
    try {
      const next = JSON.parse(saved) as Viewport;
      queueMicrotask(() => { setViewportState(next); void instance?.setViewport(next); });
    } catch { /* invalid local viewport ignored */ }
  }, [initial.project.id, instance]);

  const visibleNodes = useMemo(() => flowNodes.filter((node) => {
    const record = node.data.record as GraphNode;
    return activeTypes.has(record.node_type) && (!unresolvedOnly || record.state === "working");
  }), [activeTypes, flowNodes, unresolvedOnly]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => graph.semantic.edges.filter((edge) => visibleIds.has(edge.source_node_id) && visibleIds.has(edge.target_node_id)).map(toFlowEdge), [graph.semantic.edges, visibleIds]);

  const saveLayout = useCallback((nextNodes: readonly Node[]) => {
    const generation = ++layoutGeneration.current;
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(() => {
      const positions = Object.fromEntries(nextNodes.filter((node) => persistedNodeIds.current.has(node.id)).map((node) => [node.id, [node.position.x, node.position.y] as const]));
      const dimensions = Object.fromEntries(nextNodes.filter((node) => persistedNodeIds.current.has(node.id)).map((node) => [node.id, [
        Math.min(1200, Math.max(80, node.measured?.width ?? node.width ?? 244)),
        Math.min(900, Math.max(64, node.measured?.height ?? node.height ?? 124)),
      ] as const]));
      const operation = layoutQueue.current.catch(() => undefined).then(async () => {
        const saved = await api.saveLayout(initial.project.id, layoutVersionRef.current, positions, dimensions);
        layoutVersionRef.current = saved.version;
      });
      layoutQueue.current = operation.then(() => undefined, () => undefined);
      void operation.then(() => setTimeout(() => {
        if (layoutGeneration.current === generation) setLayoutSave("saved");
      }, 1200)).catch(() => { if (layoutGeneration.current === generation) setLayoutSave("attention"); });
    }, 180);
  }, [api, initial.project.id]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const layoutChanged = changes.some((change) => change.type === "position" || change.type === "dimensions");
    if (layoutChanged) setLayoutSave("saving");
    setFlowNodes((current) => {
      const next = applyNodeChanges(changes, current);
      if (layoutChanged) saveLayout(next);
      return next;
    });
  }, [saveLayout]);

  const persistAnnotations = useCallback((next: readonly CanvasAnnotation[], cleanup: readonly { media_id: string; upload_claim: string }[] = []) => {
    const generation = ++annotationGeneration.current;
    setAnnotationSave("saving");
    const operation = annotationQueue.current.catch(() => undefined).then(async () => {
      const saved = await api.saveAnnotations(initial.project.id, annotationVersionRef.current, next, cleanup);
      annotationVersionRef.current = saved.version;
      setTimeout(() => { if (annotationGeneration.current === generation) setAnnotationSave("saved"); }, 1200);
    }).catch((error: unknown) => { if (annotationGeneration.current === generation) setAnnotationSave("attention"); throw error; });
    annotationQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [api, initial.project.id]);

  const addThought = useCallback(() => {
    if (!user) return;
    const now = new Date().toISOString();
    const optimistic: GraphNode = { id: crypto.randomUUID(), project_id: initial.project.id, node_type: "idea", title: "New thought", content: "Captured on canvas.",
      state: "working", created_by: "user", provenance: "Canvas quick capture", tags: [], version: 1, created_at: now, updated_at: now };
    const optimisticPosition = instance?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 320, y: 240 };
    setGraph((current) => quickCapture(current, optimistic));
    setSemanticSave("saving"); setSemanticError("");
    layoutGeneration.current += 1;
    setLayoutSave("saving");
    setFlowNodes((current) => {
      const next = [...current, { ...toFlowNode(initial, optimistic, current.length), position: optimisticPosition }]; saveLayout(next); return next;
    });
    const generation = ++semanticGeneration.current;
    const operation = semanticQueue.current.catch(() => undefined).then(async () => {
      const saved = await api.createNode(initial.project.id, { node_type: "idea", title: "New thought", content: "Captured on canvas.", created_by: "user", provenance: "Canvas quick capture", tags: [], expected_project_version: projectVersionRef.current });
        projectVersionRef.current += 1;
        persistedNodeIds.current.add(saved.id);
        setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === optimistic.id ? saved : item) } }));
        setLayoutSave("saving");
        setFlowNodes((current) => {
          const next = current.map((item) => item.id === optimistic.id ? { ...item, id: saved.id, data: { record: saved } } : item);
          saveLayout(next); return next;
        });
        semanticPast.current.push({ kind: "node", node: saved }); semanticFuture.current = []; persistSemanticHistory();
    });
    semanticQueue.current = operation.then(() => undefined, () => undefined);
    void operation.then(() => { if (semanticGeneration.current === generation) setSemanticSave("saved"); }).catch(() => {
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.filter((item) => item.id !== optimistic.id) } }));
      setFlowNodes((current) => current.filter((item) => item.id !== optimistic.id));
      if (semanticGeneration.current === generation) setSemanticSave("attention");
      setSemanticError("New thought was not saved. Your draft is preserved; retry when the graph is available.");
    });
  }, [api, initial, instance, persistSemanticHistory, saveLayout, user]);

  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const now = new Date().toISOString();
    const optimistic: GraphEdge = { id: crypto.randomUUID(), project_id: initial.project.id, source_node_id: connection.source,
      target_node_id: connection.target, edge_type: "supports", label: null, version: 1, created_at: now, updated_at: now };
    setGraph((current) => replaceSemantic(current, { ...current.semantic, edges: [...current.semantic.edges, optimistic] }));
    setSemanticSave("saving"); setSemanticError("");
    const generation = ++semanticGeneration.current;
    const operation = semanticQueue.current.catch(() => undefined).then(async () => {
      const saved = await api.createEdge(initial.project.id, { source_node_id: connection.source, target_node_id: connection.target, edge_type: "supports" as EdgeType,
      label: null, expected_project_version: projectVersionRef.current });
      projectVersionRef.current += 1;
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: current.semantic.edges.map((item) => item.id === optimistic.id ? saved : item) } }));
      semanticPast.current.push({ kind: "edge", edge: saved }); semanticFuture.current = []; persistSemanticHistory();
    });
    semanticQueue.current = operation.then(() => undefined, () => undefined);
    void operation.then(() => { if (semanticGeneration.current === generation) setSemanticSave("saved"); }).catch(() => {
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: current.semantic.edges.filter((item) => item.id !== optimistic.id) } }));
      if (semanticGeneration.current === generation) setSemanticSave("attention");
      setSemanticError("Relationship was not saved. Reconnect the same nodes to retry.");
    });
  }, [api, initial.project.id, persistSemanticHistory]);

  const finishDraw = useCallback(() => {
    if (currentPoints.length < 2 || !user) { setCurrentPoints([]); return; }
    const now = new Date().toISOString();
    const mark: CanvasAnnotation = { id: crypto.randomUUID(), project_id: initial.project.id, owner_id: user.id, annotation_type: "freehand",
      path_points: currentPoints, color: "#74432f", media_id: null, version: 1, created_at: now, updated_at: now };
    const next = [...annotations.annotations, mark];
    annotationDispatch({ type: "replace", annotations: next }); setCurrentPoints([]); void persistAnnotations(next).catch(() => undefined);
  }, [annotations.annotations, currentPoints, initial.project.id, persistAnnotations, user]);

  const addMedia = useCallback(async (file: File) => {
    if (!user) return;
    const preview = URL.createObjectURL(file);
    let uploaded: Awaited<ReturnType<typeof api.uploadMedia>> | null = null;
    try {
      uploaded = await api.uploadMedia(initial.project.id, file);
      const now = new Date().toISOString();
      const annotation: CanvasAnnotation = { id: crypto.randomUUID(), project_id: initial.project.id, owner_id: user.id, annotation_type: "media",
        path_points: [], color: null, media_id: uploaded.id, version: 1, created_at: now, updated_at: now };
      const next = [...annotations.annotations, annotation];
      await persistAnnotations(next, [{ media_id: uploaded.id, upload_claim: uploaded.upload_claim }]);
      annotationDispatch({ type: "replace", annotations: next });
    } catch { if (uploaded) await api.deleteMedia(initial.project.id, uploaded.id).catch(() => undefined); }
    finally { URL.revokeObjectURL(preview); if (fileRef.current) fileRef.current.value = ""; }
  }, [annotations.annotations, api, initial.project.id, persistAnnotations, user]);

  const onSelectionChange = useCallback(({ nodes, edges }: OnSelectionChangeParams) => setSelectionCount(nodes.length + edges.length), []);
  const setViewport = useCallback((next: Viewport) => { setViewportState(next); localStorage.setItem(`creative-curator:viewport:${initial.project.id}`, JSON.stringify(next)); }, [initial.project.id]);
  const fitSelection = useCallback(() => {
    const selected = flowNodes.filter((node) => node.selected);
    void instance?.fitView({ nodes: selected.length ? selected : visibleNodes, duration: 220, padding: .24 });
  }, [flowNodes, instance, visibleNodes]);
  const resolveMedia = useCallback((mediaId: string) => api.resolveMediaUrl(initial.project.id, mediaId), [api, initial.project.id]);
  const undoGraph = useCallback(() => {
    const command = semanticPast.current.pop(); if (!command) return;
    setSemanticSave("saving"); setSemanticError(""); const generation = ++semanticGeneration.current;
    const operation = semanticQueue.current.catch(() => undefined).then(async () => {
      if (command.kind === "node") {
        const trashed = await api.trashNode(initial.project.id, command.node.id, command.node.version);
        projectVersionRef.current += 1; command.node = trashed;
        setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.filter((item) => item.id !== trashed.id) } }));
        setFlowNodes((current) => current.filter((item) => item.id !== trashed.id));
      } else {
        await api.deleteEdge(initial.project.id, command.edge.id, command.edge.version, projectVersionRef.current);
        projectVersionRef.current += 1;
        setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: current.semantic.edges.filter((item) => item.id !== command.edge.id) } }));
      }
      semanticFuture.current.push(command);
      persistSemanticHistory();
    });
    semanticQueue.current = operation.then(() => undefined, () => undefined);
    void operation.then(() => { if (semanticGeneration.current === generation) setSemanticSave("saved"); }).catch(() => {
      semanticPast.current.push(command); if (semanticGeneration.current === generation) setSemanticSave("attention");
      setSemanticError("Graph undo was not saved. Retry without leaving this project.");
    });
  }, [api, initial.project.id, persistSemanticHistory]);
  const redoGraph = useCallback(() => {
    const command = semanticFuture.current.pop(); if (!command) return;
    setSemanticSave("saving"); setSemanticError(""); const generation = ++semanticGeneration.current;
    const operation = semanticQueue.current.catch(() => undefined).then(async () => {
      if (command.kind === "node") {
        const restored = await api.restoreNode(initial.project.id, command.node.id, command.node.version);
        projectVersionRef.current += 1; command.node = restored;
        setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: [...current.semantic.nodes, restored] } }));
        setFlowNodes((current) => [...current, toFlowNode(initial, restored, current.length)]);
      } else {
        const restored = await api.createEdge(initial.project.id, { source_node_id: command.edge.source_node_id, target_node_id: command.edge.target_node_id,
          edge_type: command.edge.edge_type, label: command.edge.label, expected_project_version: projectVersionRef.current });
        projectVersionRef.current += 1; command.edge = restored;
        setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: [...current.semantic.edges, restored] } }));
      }
      semanticPast.current.push(command);
      persistSemanticHistory();
    });
    semanticQueue.current = operation.then(() => undefined, () => undefined);
    void operation.then(() => { if (semanticGeneration.current === generation) setSemanticSave("saved"); }).catch(() => {
      semanticFuture.current.push(command); if (semanticGeneration.current === generation) setSemanticSave("attention");
      setSemanticError("Graph redo was not saved. Retry without leaving this project.");
    });
  }, [api, initial, persistSemanticHistory]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const next = ({ v: "select", c: "connect", d: "draw", e: "erase" } as const)[event.key.toLowerCase() as "v"];
      if (next) { event.preventDefault(); setMode(next); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);

  return <section className="constellation-workspace">
    <header className="constellation-header"><div><p>Brand Constellation</p><h1>{initial.project.title}</h1></div>
      <div aria-live="polite" className="constellation-save"><span>{semanticStatus(semanticSave)}</span><span>{layoutStatus(layoutSave)}</span><span>{annotationStatus(annotationSave)}</span><span>{selectionCount} selected</span></div></header>
    {semanticError && <div className="constellation-domain-error" role="alert"><span>{semanticError}</span>{semanticError.startsWith("New thought") && <button onClick={addThought} type="button">Retry new thought</button>}</div>}
    <div className="constellation-grid">
      <ProjectMapPanel activeTypes={activeTypes} branches={tags(initial.nodes, "branch:")} clusters={tags(initial.nodes, "cluster:")}
        unresolvedOnly={unresolvedOnly} onFitSelection={fitSelection} onUnresolved={setUnresolvedOnly}
        onType={(type, enabled) => setActiveTypes((current) => { const next = new Set(current); if (enabled) next.add(type); else next.delete(type); return next; })} />
      <div className="constellation-canvas" data-testid="constellation-canvas" onPointerDown={(event) => {
        if (mode !== "draw" || !instance || (event.target as Element).closest(".react-flow__node, .canvas-toolbar, .react-flow__controls, .react-flow__minimap")) return;
        const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }); setCurrentPoints([[point.x, point.y]]);
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      }} onPointerMove={(event) => {
        if (mode !== "draw" || !instance || !currentPoints.length) return;
        const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }); setCurrentPoints((points) => [...points, [point.x, point.y]]);
      }} onPointerUp={finishDraw} tabIndex={0}>
        <ReactFlow ariaLabelConfig={ARIA_LABELS} autoPanOnNodeFocus edges={visibleEdges} edgeTypes={semanticEdgeTypes} elementsSelectable={mode === "select"}
          fitView multiSelectionKeyCode="Shift" nodes={visibleNodes} nodesConnectable={mode === "connect"} nodesFocusable nodesDraggable={mode === "select"}
          nodeTypes={brandNodeTypes} onConnect={connect} onInit={setInstance} onMove={(_, next) => setViewportState(next)} onMoveEnd={(_, next) => setViewport(next)} onNodesChange={onNodesChange}
          onSelectionChange={onSelectionChange} panOnDrag={mode === "select" ? [1, 2] : false} panOnScroll selectionMode={SelectionMode.Partial} selectionOnDrag={mode === "select"}>
          <Background gap={24} size={1} /><Controls /><MiniMap ariaLabel="Constellation minimap" pannable zoomable />
        </ReactFlow>
        <AnnotationLayer annotations={annotations.annotations} currentPoints={currentPoints} mode={mode} onAction={(action) => {
          const next = reduceAnnotationAction(annotations, action); annotationDispatch(action); void persistAnnotations(next.annotations).catch(() => undefined);
        }} viewport={viewport} />
        <div aria-label="Canvas media" className="media-annotation-layer" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          {annotations.annotations.filter((item) => item.annotation_type === "media" && item.media_id).map((item, index) =>
            <PersistedMedia index={index} key={item.id} mediaId={item.media_id!} resolve={resolveMedia} />)}
        </div>
        <CanvasToolbar mode={mode} onMode={setMode} onAddThought={addThought} onAddMedia={() => fileRef.current?.click()}
          onUndoGraph={undoGraph} onRedoGraph={redoGraph}
          onUndoAnnotations={() => { const next = reduceAnnotationAction(annotations, { type: "undo" }); annotationDispatch({ type: "undo" }); void persistAnnotations(next.annotations).catch(() => undefined); }}
          onRedoAnnotations={() => { const next = reduceAnnotationAction(annotations, { type: "redo" }); annotationDispatch({ type: "redo" }); void persistAnnotations(next.annotations).catch(() => undefined); }} />
        <input accept="image/jpeg,image/png,image/webp" aria-label="Choose media" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void addMedia(file); }} ref={fileRef} type="file" />
      </div>
    </div>
  </section>;
}
