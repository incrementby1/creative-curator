"use client";

import "@xyflow/react/dist/style.css";
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, applyNodeChanges,
  type Connection, type Edge, type Node, type NodeChange, type OnSelectionChangeParams, type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuth } from "../auth/auth-provider";
import { createAnnotationState, reduceAnnotationAction } from "../../lib/project-annotations";
import { acceptProposalResult, createGraphState, quickCapture, replaceSemantic } from "../../lib/project-graph";
import { createProjectsApi } from "../../lib/projects-api";
import type { CanvasAnnotation, ChallengeResolution, EdgeType, GraphEdge, GraphNode, ListedProposal, NodeRevision, NodeType, NodeUpdateInput, ProjectGraph } from "../../lib/project-types";
import { AnnotationLayer, type CanvasMode, type Viewport } from "./annotation-layer";
import { CanvasToolbar } from "./canvas-toolbar";
import { brandNodeTypes } from "./nodes/brand-node";
import { semanticEdgeTypes } from "./edges/semantic-edge";
import { ProjectMapPanel } from "./project-map-panel";
import { MediaAnnotation } from "./media-annotation";
import type { MediaObjectUrl } from "../../lib/projects-api";
import { ApiClientError } from "../../lib/api-client";
import { boundSemanticHistory, loadSemanticHistory, saveSemanticHistory, type SemanticCommand } from "./semantic-history";
import { loadViewport, saveViewport } from "./viewport-storage";
import { CommandSurface, type CaptureDraft } from "./command-surface";
import { NodeInspector } from "./node-inspector";
import { ProposalTray } from "./proposal-tray";
import { ChallengePanel, ChallengeResolutionHistory } from "./challenge-panel";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { deriveProjectTheme } from "../../lib/project-theme";
import type { ThemeChoice } from "../../lib/project-types";
import { EditorToolbar } from "../ui/editor-toolbar";
import { ThemeSelector } from "../ui/theme-selector";
import { WorkbenchPanel } from "../ui/workbench-panel";

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
  return <MotionConfig reducedMotion="user"><ReactFlowProvider><ConstellationEditorInner initial={initial} /></ReactFlowProvider></MotionConfig>;
}

function ConstellationEditorInner({ initial }: EditorProps) {
  const { client, user } = useAuth();
  const api = useMemo(() => createProjectsApi(client ?? undefined), [client]);
  const reducedMotion = useReducedMotion();
  const [theme, setTheme] = useState<ThemeChoice>(initial.theme ?? "paper");
  const [globalTheme, setGlobalTheme] = useState<ThemeChoice>(initial.global_theme ?? initial.theme ?? "paper");
  const [projectTheme, setProjectTheme] = useState<ThemeChoice | null>(initial.project_theme ?? null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeError, setThemeError] = useState("");
  const liveInitialNodes = useMemo(() => initial.nodes.filter((node) => node.state !== "trash"), [initial.nodes]);
  const liveInitialIds = useMemo(() => new Set(liveInitialNodes.map((node) => node.id)), [liveInitialNodes]);
  const liveInitialEdges = useMemo(() => initial.edges.filter((edge) => liveInitialIds.has(edge.source_node_id) && liveInitialIds.has(edge.target_node_id)), [initial.edges, liveInitialIds]);
  const [graph, setGraph] = useState(() => createGraphState(liveInitialNodes, liveInitialEdges));
  const [flowNodes, setFlowNodes] = useState<Node[]>(() => liveInitialNodes.map((node, index) => toFlowNode(initial, node, index)));
  const [mode, setMode] = useState<CanvasMode>("select");
  const [activeTypes, setActiveTypes] = useState<Set<NodeType>>(() => new Set(ALL_TYPES));
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisScope, setAnalysisScope] = useState<readonly string[]>([]);
  const [proposals, setProposals] = useState<ListedProposal[]>([]);
  const [dismissedProposals, setDismissedProposals] = useState<Set<string>>(() => new Set());
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalError, setProposalError] = useState("");
  const [revisions, setRevisions] = useState<NodeRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [challengeResolutions, setChallengeResolutions] = useState<Record<string, readonly ChallengeResolution[]>>({});
  const [restoredAnalysis, setRestoredAnalysis] = useState<{ selectedNodeId: string; analysisType: string; expectedProjectVersion: number; idempotencyKey: string } | null>(null);
  const [viewport, setViewportState] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [layoutSave, setLayoutSave] = useState<SaveState>("saved");
  const [annotationSave, setAnnotationSave] = useState<SaveState>("saved");
  const [semanticSave, setSemanticSave] = useState<SaveState>("saved");
  const [semanticError, setSemanticError] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  const [mediaRecovery, setMediaRecovery] = useState<{ message: string; actionLabel: string; action: () => void } | null>(null);
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
  const enqueueSemantic = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const result = semanticQueue.current.catch(() => undefined).then(work);
    semanticQueue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);
  const semanticGeneration = useRef(0);
  const semanticPast = useRef<SemanticCommand[]>([]);
  const semanticFuture = useRef<SemanticCommand[]>([]);
  const semanticHistoryPersistence = useRef(true);
  const semanticHistoryKey = `creative-curator:semantic-history:${initial.project.id}`;
  const persistSemanticHistory = useCallback(() => {
    const bounded = boundSemanticHistory({ past: semanticPast.current, future: semanticFuture.current });
    semanticPast.current = bounded.past; semanticFuture.current = bounded.future;
    if (!semanticHistoryPersistence.current) return;
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* browser persistence is optional */ }
    if (!saveSemanticHistory(storage, semanticHistoryKey, bounded)) {
      semanticHistoryPersistence.current = false;
      setHistoryNotice("Graph history remains available only until this tab closes.");
    }
  }, [semanticHistoryKey]);

  useEffect(() => () => { if (layoutTimer.current) clearTimeout(layoutTimer.current); }, []);
  useEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* browser persistence is optional */ }
    const saved = loadSemanticHistory(storage, semanticHistoryKey, initial.project.id);
    semanticPast.current = saved.past; semanticFuture.current = saved.future;
    semanticHistoryPersistence.current = saved.persistenceAvailable;
  }, [initial.project.id, semanticHistoryKey]);
  useEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* optional persistence */ }
    const next = loadViewport(storage, `creative-curator:viewport:${initial.project.id}`);
    if (next) queueMicrotask(() => { setViewportState(next); void instance?.setViewport(next); });
  }, [initial.project.id, instance]);
  useEffect(() => { void api.listProposals(initial.project.id).then((items) => setProposals(items.filter((item) => item.state === "pending"))).catch(() => undefined); }, [api, initial.project.id]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`creative-curator:analysis-retry:${initial.project.id}`); if (!raw) return;
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (typeof value.selectedNodeId === "string" && liveInitialIds.has(value.selectedNodeId)
          && typeof value.analysisType === "string" && typeof value.expectedProjectVersion === "number"
          && typeof value.idempotencyKey === "string") {
        const restored = value as { selectedNodeId: string; analysisType: string; expectedProjectVersion: number; idempotencyKey: string };
        setRestoredAnalysis(restored); setSelectedNodeId(restored.selectedNodeId);
        setFlowNodes((items) => items.map((item) => ({ ...item, selected: item.id === restored.selectedNodeId })));
      }
    } catch { sessionStorage.removeItem(`creative-curator:analysis-retry:${initial.project.id}`); }
  }, [initial.project.id, liveInitialIds]);

  const selectedNode = useMemo(() => graph.semantic.nodes.find((node) => node.id === selectedNodeId) ?? null, [graph.semantic.nodes, selectedNodeId]);
  useEffect(() => {
    if (!selectedNodeId) { setRevisions([]); return; }
    let active = true; setRevisionsLoading(true);
    void api.listNodeRevisions(initial.project.id, selectedNodeId).then((items) => { if (active) setRevisions(items); }).catch(() => { if (active) setRevisions([]); }).finally(() => { if (active) setRevisionsLoading(false); });
    return () => { active = false; };
  }, [api, initial.project.id, selectedNodeId]);
  useEffect(() => {
    if (!selectedNode) return;
    let active = true; void api.listChallengeResolutions(initial.project.id, selectedNode.id).then((items) => {
      if (active) setChallengeResolutions((current) => ({ ...current, [selectedNode.id]: items }));
    }).catch(() => undefined); return () => { active = false; };
  }, [api, initial.project.id, selectedNode]);

  const visibleNodes = useMemo(() => flowNodes.filter((node) => {
    const record = node.data.record as GraphNode;
    return activeTypes.has(record.node_type) && (!unresolvedOnly || record.state === "working");
  }), [activeTypes, flowNodes, unresolvedOnly]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => graph.semantic.edges.filter((edge) => visibleIds.has(edge.source_node_id) && visibleIds.has(edge.target_node_id)).map(toFlowEdge), [graph.semantic.edges, visibleIds]);
  const reviewProposals = useMemo(() => proposals.filter((proposal) => !dismissedProposals.has(proposal.id)), [dismissedProposals, proposals]);
  const previewNodes = useMemo(() => reviewProposals.flatMap((proposal, proposalIndex) => proposal.candidate.proposed_nodes.map((item, index) => ({
    id: `preview:${proposal.id}:${item.client_key}`, type: "brand", draggable: false, selectable: false,
    position: { x: 460 + proposalIndex * 36, y: 80 + index * 164 }, data: { preview: true, record: { id: `preview:${item.client_key}`, project_id: initial.project.id, node_type: item.node_type, title: item.title, content: item.content, state: "working", created_by: "hermes", provenance: item.rationale, tags: [], version: 0, created_at: "", updated_at: "" } as GraphNode }, style: { width: 244, height: 124 },
  }))), [initial.project.id, reviewProposals]);
  const displayedNodes = useMemo(() => [...visibleNodes, ...previewNodes], [previewNodes, visibleNodes]);
  const previewEdges = useMemo(() => reviewProposals.flatMap((proposal) => {
    const proposedKeys = new Set(proposal.candidate.proposed_nodes.map((node) => node.client_key));
    const endpoint = (key: string) => proposedKeys.has(key) ? `preview:${proposal.id}:${key}` : key;
    return proposal.candidate.proposed_edges.map((edge, index) => ({ id: `preview-edge:${proposal.id}:${index}`, source: endpoint(edge.source_key), target: endpoint(edge.target_key), type: "semantic", selectable: false, data: { edgeType: edge.edge_type, preview: true }, style: { opacity: .65 } } as Edge));
  }), [reviewProposals]);
  const displayedEdges = useMemo(() => [...visibleEdges, ...previewEdges], [previewEdges, visibleEdges]);
  const selectedConnections = useMemo(() => selectedNode ? graph.semantic.edges.filter((edge) => edge.source_node_id === selectedNode.id || edge.target_node_id === selectedNode.id).map((edge) => {
    const other = graph.semantic.nodes.find((node) => node.id === (edge.source_node_id === selectedNode.id ? edge.target_node_id : edge.source_node_id));
    return `${edge.edge_type.replaceAll("_", " ")} ${other?.title ?? "Unknown node"}`;
  }) : [], [graph.semantic.edges, graph.semantic.nodes, selectedNode]);
  const selectedChallengeDependencies = useMemo(() => selectedNode?.challenge_dependencies?.length
    ? selectedNode.challenge_dependencies.map((id) => graph.semantic.nodes.find((node) => node.id === id)?.title ?? id)
    : selectedConnections, [graph.semantic.nodes, selectedConnections, selectedNode]);
  const derivedTheme = useMemo(() => deriveProjectTheme(theme, graph.semantic.nodes), [graph.semantic.nodes, theme]);
  const themeStyle = useMemo(() => ({ "--project-accent": derivedTheme.tokens.accent, "--project-accent-text": derivedTheme.tokens.accentText } as React.CSSProperties), [derivedTheme]);
  const applyThemePreferences = useCallback((loaded: ProjectGraph) => {
    setTheme(loaded.theme ?? "paper"); setGlobalTheme(loaded.global_theme ?? loaded.theme ?? "paper"); setProjectTheme(loaded.project_theme ?? null);
  }, []);
  const persistGlobalTheme = useCallback((choice: ThemeChoice) => {
    setThemeBusy(true); setThemeError(""); void api.setGlobalTheme(choice).then(() => api.loadProject(initial.project.id)).then(applyThemePreferences)
      .catch(() => setThemeError("Global theme was not saved. Try again.")).finally(() => setThemeBusy(false));
  }, [api, applyThemePreferences, initial.project.id]);
  const persistProjectTheme = useCallback((choice: ThemeChoice | null) => {
    setThemeBusy(true); setThemeError(""); void api.setProjectTheme(initial.project.id, choice).then(async () => {
      const loaded = await api.loadProject(initial.project.id); applyThemePreferences(loaded);
    }).catch(() => setThemeError("Project theme was not saved. Try again.")).finally(() => setThemeBusy(false));
  }, [api, applyThemePreferences, initial.project.id]);

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

  const addMedia = useCallback(async function uploadMediaFile(file: File) {
    if (!user) return;
    setAnnotationSave("saving"); setMediaRecovery(null);
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
    } catch {
      setAnnotationSave("attention");
      const retryUpload = () => { void uploadMediaFile(file); };
      if (!uploaded) {
        setMediaRecovery({ message: "Media upload failed. File remains available in this tab.", actionLabel: "Retry media upload", action: retryUpload });
      } else {
        const mediaId = uploaded.id;
        setMediaRecovery({ message: "Media placement was not saved. File remains available in this tab.", actionLabel: "Retry media upload", action: retryUpload });
        const cleanup = async () => {
          try {
            await api.deleteMedia(initial.project.id, mediaId);
            setMediaRecovery({ message: "Media placement was not saved. File remains available in this tab.", actionLabel: "Retry media upload", action: retryUpload });
          } catch (error) {
            if (error instanceof ApiClientError && error.status === 404) {
              setMediaRecovery({ message: "Media placement was not saved. File remains available in this tab.", actionLabel: "Retry media upload", action: retryUpload });
              return;
            }
            setMediaRecovery({ message: "Uploaded media cleanup failed. Retry cleanup before uploading again.", actionLabel: "Retry media cleanup", action: () => { void cleanup(); } });
          }
        };
        await cleanup();
      }
    }
    finally { URL.revokeObjectURL(preview); if (fileRef.current) fileRef.current.value = ""; }
  }, [annotations.annotations, api, initial.project.id, persistAnnotations, user]);

  const captureDraft = useCallback(async (draft: CaptureDraft) => {
    if (!user) throw new Error("authentication_required");
    setCaptureBusy(true); setSemanticSave("saving"); setSemanticError("");
    const now = new Date().toISOString();
    const optimistic: GraphNode = { id: crypto.randomUUID(), project_id: initial.project.id, ...draft, state: "working", created_by: "user", provenance: "Quick capture", tags: [], version: 1, created_at: now, updated_at: now };
    const position = instance?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 320, y: 240 };
    setGraph((current) => quickCapture(current, optimistic));
    setFlowNodes((current) => [...current, { ...toFlowNode(initial, optimistic, current.length), position }]);
    try {
      const saved = await enqueueSemantic(() => api.createNode(initial.project.id, { ...draft, created_by: "user", provenance: "Quick capture", tags: [], expected_project_version: projectVersionRef.current }).then((value) => { projectVersionRef.current += 1; return value; }));
      persistedNodeIds.current.add(saved.id);
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === optimistic.id ? saved : item) } }));
      setFlowNodes((current) => { const next = current.map((item) => item.id === optimistic.id ? { ...item, id: saved.id, data: { record: saved } } : item); saveLayout(next); return next; });
      setSemanticSave("saved");
    } catch (error) {
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.filter((item) => item.id !== optimistic.id) } }));
      setFlowNodes((current) => current.filter((item) => item.id !== optimistic.id)); setSemanticSave("attention"); throw error;
    } finally { setCaptureBusy(false); }
  }, [api, enqueueSemantic, initial, instance, saveLayout, user]);

  const saveInspectedNode = useCallback(async (input: NodeUpdateInput) => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    const saved = await enqueueSemantic(() => api.updateNode(initial.project.id, nodeId, { ...input, expected_project_version: projectVersionRef.current }).then((value) => { projectVersionRef.current += 1; return value; }));
    setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === saved.id ? saved : item) } }));
    setFlowNodes((current) => current.map((item) => item.id === saved.id ? { ...item, data: { record: saved } } : item));
    setRevisions(await api.listNodeRevisions(initial.project.id, saved.id));
  }, [api, enqueueSemantic, initial.project.id, selectedNode]);

  const connectInspectedNode = useCallback(async (targetId: string, edgeType: EdgeType) => {
    if (!selectedNode) return;
    setSemanticSave("saving"); const operation = semanticQueue.current.catch(() => undefined).then(async () => {
      const saved = await api.createEdge(initial.project.id, { source_node_id: selectedNode.id, target_node_id: targetId, edge_type: edgeType, label: null, expected_project_version: projectVersionRef.current });
      projectVersionRef.current += 1; setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: [...current.semantic.edges, saved] } }));
    });
    semanticQueue.current = operation.then(() => undefined, () => undefined);
    try { await operation; setSemanticSave("saved"); } catch (error) { setSemanticSave("attention"); throw error; }
  }, [api, initial.project.id, selectedNode]);

  const refreshSemantic = useCallback(async () => {
    const loaded = await api.loadProject(initial.project.id); const live = loaded.nodes.filter((node) => node.state !== "trash"); const ids = new Set(live.map((node) => node.id));
    projectVersionRef.current = loaded.project.version; setGraph(createGraphState(live, loaded.edges.filter((edge) => ids.has(edge.source_node_id) && ids.has(edge.target_node_id))));
    setFlowNodes(live.map((node, index) => toFlowNode(loaded, node, index)));
  }, [api, initial.project.id]);

  const runAnalysis = useCallback(async () => {
    if (!selectedNode) return;
    const neighborIds = new Set([selectedNode.id]); graph.semantic.edges.forEach((edge) => { if (edge.source_node_id === selectedNode.id) neighborIds.add(edge.target_node_id); if (edge.target_node_id === selectedNode.id) neighborIds.add(edge.source_node_id); });
    setAnalysisScope(graph.semantic.nodes.filter((node) => neighborIds.has(node.id)).map((node) => node.title)); setAnalysisBusy(true); setAnalysisError("");
    const request = restoredAnalysis?.selectedNodeId === selectedNode.id ? restoredAnalysis : { selectedNodeId: selectedNode.id, analysisType: "guided_exploration", expectedProjectVersion: projectVersionRef.current, idempotencyKey: crypto.randomUUID() };
    try {
      const result = await api.analyze(initial.project.id, request.selectedNodeId, request.analysisType, request.expectedProjectVersion, request.idempotencyKey);
      const listed: ListedProposal = { ...result.proposal, candidate: result.candidate }; setProposals((current) => [listed, ...current.filter((item) => item.id !== listed.id)]);
      const ids = new Set(result.proposal.dependency_node_versions.map(([id]) => id)); setAnalysisScope(graph.semantic.nodes.filter((node) => ids.has(node.id)).map((node) => node.title));
      try { sessionStorage.removeItem(`creative-curator:analysis-retry:${initial.project.id}`); } catch { /* optional */ } setRestoredAnalysis(null);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "ai_configuration_required") {
        try { sessionStorage.setItem(`creative-curator:analysis-retry:${initial.project.id}`, JSON.stringify(request)); } catch { /* tab storage optional */ }
        setAnalysisError("AI configuration required. Request preserved.");
      } else setAnalysisError("Hermes could not finish. Selection and scope preserved; retry when provider is available.");
    } finally { setAnalysisBusy(false); }
  }, [api, graph.semantic.edges, graph.semantic.nodes, initial.project.id, restoredAnalysis, selectedNode]);

  const acceptProposal = useCallback(async (proposalId: string) => {
    setProposalBusy(true); setProposalError("");
    try { const accepted = await enqueueSemantic(() => api.acceptProposal(initial.project.id, proposalId, projectVersionRef.current).then((value) => { projectVersionRef.current += 1; return value; })); accepted.nodes.forEach((node) => persistedNodeIds.current.add(node.id)); setGraph((current) => acceptProposalResult(current, accepted)); setFlowNodes((current) => { const ids = new Set(current.map((node) => node.id)); return [...current.filter((node) => !node.id.startsWith(`preview:${proposalId}:`)), ...accepted.nodes.filter((node) => !ids.has(node.id)).map((node, index) => toFlowNode(initial, node, current.length + index))]; }); setProposals((items) => items.filter((item) => item.id !== proposalId)); }
    catch (error) {
      if (error instanceof ApiClientError && error.code === "version_conflict") { await enqueueSemantic(refreshSemantic).catch(() => undefined); setProposalError("Project changed elsewhere. Latest version loaded; review proposal and retry."); }
      else setProposalError("Proposal was not applied. Graph remains unchanged; retry.");
    } finally { setProposalBusy(false); }
  }, [api, enqueueSemantic, initial, refreshSemantic]);

  const rejectProposal = useCallback(async (proposalId: string) => {
    setProposalBusy(true); setProposalError("");
    try { await enqueueSemantic(() => api.rejectProposal(initial.project.id, proposalId)); setProposals((items) => items.filter((item) => item.id !== proposalId)); setDismissedProposals((current) => new Set(current).add(proposalId)); }
    catch { setProposalError("Proposal rejection failed. Preview retained for retry."); }
    finally { setProposalBusy(false); }
  }, [api, enqueueSemantic, initial.project.id]);

  const resolveChallenge = useCallback(async (state: "resolved" | "deferred" | "overridden", note: string) => {
    if (!selectedNode) return; const nodeId = selectedNode.id; const saved = await enqueueSemantic(() => api.resolveChallenge(initial.project.id, nodeId, state, note, projectVersionRef.current).then((value) => { projectVersionRef.current += 1; return value; })); setChallengeResolutions((current) => ({ ...current, [nodeId]: [saved, ...(current[nodeId] ?? []).filter((item) => item.id !== saved.id)] }));
  }, [api, enqueueSemantic, initial.project.id, selectedNode]);

  const onSelectionChange = useCallback(({ nodes, edges }: OnSelectionChangeParams) => { setSelectionCount(nodes.length + edges.length); setSelectedNodeId(nodes.length === 1 ? nodes[0].id : null); }, []);
  const setViewport = useCallback((next: Viewport) => {
    setViewportState(next); let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* optional persistence */ }
    saveViewport(storage, `creative-curator:viewport:${initial.project.id}`, next);
  }, [initial.project.id]);
  const resizeNode = useCallback((id: string, requestedWidth: number, requestedHeight: number) => {
    const width = Math.min(1200, Math.max(208, requestedWidth)); const height = Math.min(900, Math.max(112, requestedHeight));
    setLayoutSave("saving"); setFlowNodes((current) => {
      const next = current.map((node) => node.id === id ? { ...node, width, height, measured: { width, height }, style: { ...node.style, width, height } } : node);
      saveLayout(next); return next;
    });
  }, [saveLayout]);
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
        setFlowNodes((current) => current.map((item) => item.id === trashed.id ? { ...item, data: { ...item.data, removing: true } } : item));
        if (!reducedMotion) await new Promise((resolve) => setTimeout(resolve, 120));
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
  }, [api, initial.project.id, persistSemanticHistory, reducedMotion]);
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

  return <motion.section animate={{ opacity: 1 }} className="constellation-workspace workbench-motion" data-theme={theme} initial={reducedMotion ? false : { opacity: .98 }} style={themeStyle} transition={{ duration: reducedMotion ? 0 : .14 }}>
    <EditorToolbar aria-label="Project toolbar" className="constellation-header"><div><p>Brand Constellation</p><h1>{initial.project.title}</h1></div>
      <div aria-live="polite" className="constellation-save"><span>{semanticStatus(semanticSave)}</span><span>{layoutStatus(layoutSave)}</span><span>{annotationStatus(annotationSave)}</span><span>{selectionCount} selected</span></div>
      <ThemeSelector busy={themeBusy} effectiveTheme={theme} globalTheme={globalTheme} projectTheme={projectTheme} onGlobalTheme={persistGlobalTheme} onProjectTheme={persistProjectTheme} /></EditorToolbar>
    {themeError && <p className="constellation-domain-error" role="alert">{themeError}</p>}
    {semanticError && <div className="constellation-domain-error" role="alert"><span>{semanticError}</span>{semanticError.startsWith("New thought") && <button onClick={addThought} type="button">Retry new thought</button>}</div>}
    {mediaRecovery && <div className="constellation-domain-error" role="alert"><span>{mediaRecovery.message}</span><button onClick={mediaRecovery.action} type="button">{mediaRecovery.actionLabel}</button></div>}
    {historyNotice && <p className="constellation-history-notice" role="status">{historyNotice}</p>}
    <div className="constellation-grid" data-work-panel={selectedNode || reviewProposals.length ? "open" : "closed"}>
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
        <ReactFlow ariaLabelConfig={ARIA_LABELS} autoPanOnNodeFocus edges={displayedEdges} edgeTypes={semanticEdgeTypes} elementsSelectable={mode === "select"}
          fitView multiSelectionKeyCode="Shift" nodes={displayedNodes} nodesConnectable={mode === "connect"} nodesFocusable nodesDraggable={mode === "select"}
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
          nodes={graph.semantic.nodes.map((node) => ({ id: node.id, title: node.title }))}
          onConnectNodes={(source, target) => connect({ source, target, sourceHandle: null, targetHandle: null })} onResizeNode={resizeNode}
          onUndoGraph={undoGraph} onRedoGraph={redoGraph}
          onUndoAnnotations={() => { const next = reduceAnnotationAction(annotations, { type: "undo" }); annotationDispatch({ type: "undo" }); void persistAnnotations(next.annotations).catch(() => undefined); }}
          onRedoAnnotations={() => { const next = reduceAnnotationAction(annotations, { type: "redo" }); annotationDispatch({ type: "redo" }); void persistAnnotations(next.annotations).catch(() => undefined); }} />
        <input accept="image/jpeg,image/png,image/webp" aria-label="Choose media" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void addMedia(file); }} ref={fileRef} type="file" />
      </div>
      <WorkBenchMotionPanel reducedMotion={Boolean(reducedMotion)}>
        {restoredAnalysis && <div className="constellation-panel" role="status"><strong>Analysis request restored</strong><p>Selection and analysis type are ready. Retry only when you choose.</p><div className="panel-actions"><button onClick={() => void runAnalysis()} type="button">Retry preserved analysis</button><button onClick={() => { try { sessionStorage.removeItem(`creative-curator:analysis-retry:${initial.project.id}`); } catch { /* optional */ } setRestoredAnalysis(null); }} type="button">Cancel preserved analysis</button></div></div>}
        <CommandSurface busy={captureBusy} onCapture={captureDraft} />
        {selectedNode && <section className="guided-analysis" aria-label="Guided exploration"><div><p>Hermes</p><h2>Guided exploration</h2></div><button disabled={analysisBusy} onClick={() => void runAnalysis()} type="button">{analysisBusy ? "Hermes is analyzing…" : "Explore selected node"}</button>
          {analysisScope.length > 0 && <div><h3>Relevant scope</h3><ul>{analysisScope.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {analysisError && <div role="alert"><p>{analysisError}</p>{analysisError.startsWith("AI configuration") ? <a href={`/settings?returnTo=${encodeURIComponent(`/projects/${initial.project.id}`)}`}>Open Settings</a> : <button onClick={() => void runAnalysis()} type="button">Retry analysis</button>}</div>}
        </section>}
        {proposalError && <p className="work-panel-error" role="alert">{proposalError}</p>}
        <ProposalTray accepting={proposalBusy} proposals={reviewProposals} onAccept={(id) => void acceptProposal(id)} onReject={(id) => void rejectProposal(id)} />
        {selectedNode?.node_type === "challenge" && <ChallengePanel challenge={selectedNode} dependencies={selectedChallengeDependencies} historyHref={`#challenge-resolution-history-${selectedNode.id}`} resolutions={challengeResolutions[selectedNode.id]} onResolve={resolveChallenge} />}
        {selectedNode?.node_type !== "challenge" && selectedNode && (challengeResolutions[selectedNode.id]?.length ?? 0) > 0 && <section className="constellation-panel" aria-label="Challenge resolution archive"><header><p>Immutable record</p><h2>Prior challenge resolutions</h2></header><ChallengeResolutionHistory historyHref={`#challenge-resolution-history-${selectedNode.id}`} nodeId={selectedNode.id} resolutions={challengeResolutions[selectedNode.id]} /></section>}
        {selectedNode && <NodeInspector availableNodes={graph.semantic.nodes} connections={selectedConnections} key={selectedNode.id} loadingRevisions={revisionsLoading} node={selectedNode} onConnect={connectInspectedNode} onSave={saveInspectedNode} revisions={revisions} />}
      </WorkBenchMotionPanel>
    </div>
  </motion.section>;
}

function WorkBenchMotionPanel({ children, reducedMotion }: { children: React.ReactNode; reducedMotion: boolean }) {
  return <WorkbenchPanel as={motion.aside} animate={{ opacity: 1 }} aria-label="Constellation work panel" className="constellation-work-panel"
    initial={reducedMotion ? false : { opacity: .96 }} transition={{ duration: reducedMotion ? 0 : .16 }}>{children}</WorkbenchPanel>;
}
