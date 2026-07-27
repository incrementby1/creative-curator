"use client";

import "@xyflow/react/dist/style.css";
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, applyNodeChanges,
  useOnViewportChange,
  type Connection, type Edge, type Node, type NodeChange, type OnSelectionChangeParams, type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
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
import {
  commitWorkspaceRedo, commitWorkspaceUndo, emptyWorkspaceHistory, loadWorkspaceHistory,
  recordWorkspaceCommand, redoCandidate, saveWorkspaceHistory, undoCandidate,
  type SemanticCommand, type WorkspaceCommand, type WorkspaceHistory,
} from "./workspace-history";
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
import Link from "next/link";
import { AccessibleGraph } from "./accessible-graph";
import { MobileGraphNavigator } from "./mobile-graph-navigator";
import { ConflictPanel } from "./conflict-panel";
import { PendingEditStore, classifyPendingFailure, projectGraphPerformanceMode, replayPendingEdits, type PendingProjectEdit } from "../../lib/pending-project-edits";
import { hydratePendingConflict, type ConflictValues } from "../../lib/project-conflicts";
import { TerminalRecoveryPanel } from "./terminal-recovery-panel";
import { HeldRecoveryPanel } from "./held-recovery-panel";
import { TrashedNodesPanel } from "./trashed-nodes-panel";

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
function ViewportLayers({ annotations, currentPoints, mode, onAction, resolveMedia }: {
  annotations: readonly CanvasAnnotation[]; currentPoints: readonly (readonly [number, number])[]; mode: CanvasMode;
  onAction: (action: Parameters<typeof reduceAnnotationAction>[1]) => void; resolveMedia: (mediaId: string) => Promise<MediaObjectUrl>;
}) {
  const [liveViewport, setLiveViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  useOnViewportChange({ onChange: setLiveViewport });
  return <><AnnotationLayer annotations={annotations} currentPoints={currentPoints} mode={mode} onAction={onAction} viewport={liveViewport} />
    <div aria-label="Canvas media" className="media-annotation-layer" style={{ transform: `translate(${liveViewport.x}px, ${liveViewport.y}px) scale(${liveViewport.zoom})` }}>
      {annotations.filter((item) => item.annotation_type === "media" && item.media_id).map((item, index) => <PersistedMedia index={index} key={item.id} mediaId={item.media_id!} resolve={resolveMedia} />)}
    </div></>;
}
const layoutStatus = (state: SaveState) => state === "saving" ? "Saving layout…" : state === "attention" ? "Layout needs attention" : "Layout saved";
const annotationStatus = (state: SaveState) => state === "saving" ? "Saving annotations…" : state === "attention" ? "Annotations need attention" : "Annotations saved";
const semanticStatus = (state: SaveState) => state === "saving" ? "Saving graph…" : state === "attention" ? "Graph needs attention" : "Graph saved";
const tags = (nodes: readonly GraphNode[], prefix: string) => [...new Set(nodes.flatMap((node) => node.tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length))))].sort();
const subscribeMobile = (notify: () => void) => { const query = window.matchMedia("(max-width: 640px)"); query.addEventListener("change", notify); return () => query.removeEventListener("change", notify); };
const mobileSnapshot = () => window.matchMedia("(max-width: 640px)").matches;
const desktopSnapshot = () => false;

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
  const isMobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, desktopSnapshot);
  const [theme, setTheme] = useState<ThemeChoice>(initial.theme ?? "paper");
  const [globalTheme, setGlobalTheme] = useState<ThemeChoice>(initial.global_theme ?? initial.theme ?? "paper");
  const [projectTheme, setProjectTheme] = useState<ThemeChoice | null>(initial.project_theme ?? null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeError, setThemeError] = useState("");
  const liveInitialNodes = useMemo(() => initial.nodes.filter((node) => node.state !== "trash"), [initial.nodes]);
  const liveInitialIds = useMemo(() => new Set(liveInitialNodes.map((node) => node.id)), [liveInitialNodes]);
  const liveInitialEdges = useMemo(() => initial.edges.filter((edge) => liveInitialIds.has(edge.source_node_id) && liveInitialIds.has(edge.target_node_id)), [initial.edges, liveInitialIds]);
  const [graph, setGraph] = useState(() => createGraphState(liveInitialNodes, liveInitialEdges));
  const [trashedNodes, setTrashedNodes] = useState<GraphNode[]>(() => initial.nodes.filter((node) => node.state === "trash"));
  const [flowNodes, setFlowNodes] = useState<Node[]>(() => liveInitialNodes.map((node, index) => toFlowNode(initial, node, index)));
  const flowNodesRef = useRef(flowNodes);
  const [mode, setMode] = useState<CanvasMode>("select");
  const [activeTypes, setActiveTypes] = useState<Set<NodeType>>(() => new Set(ALL_TYPES));
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphView, setGraphView] = useState<"canvas" | "structured">("canvas");
  const [expandDistantClusters, setExpandDistantClusters] = useState(false);
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
  const [annotationError, setAnnotationError] = useState("");
  const [semanticSave, setSemanticSave] = useState<SaveState>("saved");
  const [semanticError, setSemanticError] = useState("");
  const [inspectorEpoch, setInspectorEpoch] = useState(0);
  const [inspectorFocusRequest, setInspectorFocusRequest] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ nodeId: string; submitted: NodeUpdateInput; latest: GraphNode; latestProject: ProjectGraph["project"]; submittedVersion: number; pending?: PendingProjectEdit } | null>(null);
  const [genericConflict, setGenericConflict] = useState<{ edit: PendingProjectEdit; latest: ProjectGraph; values: ConflictValues } | null>(null);
  const [unstoredEdits, setUnstoredEdits] = useState<readonly PendingProjectEdit[]>([]);
  const [heldTerminalEdits, setHeldTerminalEdits] = useState<readonly PendingProjectEdit[]>([]);
  const [terminalRecovery, setTerminalRecovery] = useState<{ edit: PendingProjectEdit; category: string } | null>(null);
  const [replayGeneration, setReplayGeneration] = useState(0);
  const pendingStore = useMemo(() => {
    try { return new PendingEditStore(window.localStorage); } catch { return new PendingEditStore(null); }
  }, []);
  const queuePendingEdit = useCallback((operation: PendingProjectEdit["operation"], expectedVersion: number, payload: Record<string, unknown>, idempotencyKey = crypto.randomUUID(), error?: unknown) => {
    if (!user || classifyPendingFailure(error) !== "retryable") return false;
    const edit: PendingProjectEdit = { schemaVersion: 1, ownerId: user.id, projectId: initial.project.id, idempotencyKey, expectedVersion, operation, payload, createdAt: Date.now() };
    if (pendingStore.enqueue(edit)) { setUnstoredEdits((current) => current.filter((item) => item.idempotencyKey !== idempotencyKey)); return true; }
    setUnstoredEdits((current) => [...current.filter((item) => item.idempotencyKey !== idempotencyKey), edit]);
    setSemanticSave("attention"); setSemanticError("Not stored—keep this tab open. Allow browser storage, then reconnect to retry.");
    return false;
  }, [initial.project.id, pendingStore, user]);
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
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceHistory>(emptyWorkspaceHistory);
  const workspaceHistoryRef = useRef<WorkspaceHistory>(workspaceHistory);
  const workspaceHistoryBusy = useRef(false);
  const workspaceHistoryPersistence = useRef(true);
  const workspaceHistoryKey = user ? `creative-curator:workspace-history:v1:${user.id}:${initial.project.id}` : "";
  const setHistory = useCallback((next: WorkspaceHistory) => {
    workspaceHistoryRef.current = next;
    setWorkspaceHistory(next);
  }, []);
  const persistWorkspaceHistory = useCallback((history: WorkspaceHistory) => {
    if (!workspaceHistoryPersistence.current || !workspaceHistoryKey) return;
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* browser persistence is optional */ }
    if (!saveWorkspaceHistory(storage, workspaceHistoryKey, history)) {
      workspaceHistoryPersistence.current = false;
      setHistoryNotice("Undo history remains available only until this tab closes.");
    }
  }, [workspaceHistoryKey]);
  const recordHistory = useCallback((action: WorkspaceCommand["action"]) => {
    if (!user) return;
    const command: WorkspaceCommand = { schemaVersion: 1, ownerId: user.id, projectId: initial.project.id, createdAt: Date.now(), action };
    const next = recordWorkspaceCommand(workspaceHistoryRef.current, command);
    setHistory(next);
    persistWorkspaceHistory(next);
  }, [initial.project.id, persistWorkspaceHistory, setHistory, user]);

  useEffect(() => () => { if (layoutTimer.current) clearTimeout(layoutTimer.current); }, []);
  useEffect(() => {
    if (!user) return;
    const warn = (event: BeforeUnloadEvent) => { const loaded = pendingStore.load(user.id, initial.project.id); if (loaded.items.length || unstoredEdits.length || heldTerminalEdits.length) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [heldTerminalEdits.length, initial.project.id, pendingStore, unstoredEdits.length, user]);
  useEffect(() => { flowNodesRef.current = flowNodes; }, [flowNodes]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("node");
    if (!requested || !liveInitialIds.has(requested)) return;
    setSelectedNodeId(requested);
    setFlowNodes((items) => items.map((item) => ({ ...item, selected: item.id === requested })));
  }, [liveInitialIds]);
  useEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* browser persistence is optional */ }
    if (!user || !workspaceHistoryKey) return;
    const saved = loadWorkspaceHistory(storage, workspaceHistoryKey, user.id, initial.project.id);
    setHistory({ past: saved.past, future: saved.future });
    workspaceHistoryPersistence.current = saved.persistenceAvailable;
    if (!saved.persistenceAvailable) setHistoryNotice("Undo history remains available only until this tab closes.");
  }, [initial.project.id, setHistory, user, workspaceHistoryKey]);
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
  const collapseDistant = visibleNodes.length >= 250 && !expandDistantClusters;
  const canvasVisibleNodes = useMemo(() => {
    if (!collapseDistant) return visibleNodes;
    const clusters = new Set<string>();
    return visibleNodes.filter((node) => {
      if (node.id === selectedNodeId || node.selected) return true;
      const record = node.data.record as GraphNode; const cluster = record.tags.find((tag) => tag.startsWith("cluster:") || tag.startsWith("branch:"));
      if (!cluster) return true; if (clusters.has(cluster)) return false; clusters.add(cluster); return true;
    });
  }, [collapseDistant, selectedNodeId, visibleNodes]);
  const visibleIds = useMemo(() => new Set(canvasVisibleNodes.map((node) => node.id)), [canvasVisibleNodes]);
  const visibleEdges = useMemo(() => graph.semantic.edges.filter((edge) => visibleIds.has(edge.source_node_id) && visibleIds.has(edge.target_node_id)).map(toFlowEdge), [graph.semantic.edges, visibleIds]);
  const reviewProposals = useMemo(() => proposals.filter((proposal) => !dismissedProposals.has(proposal.id)), [dismissedProposals, proposals]);
  const previewNodes = useMemo(() => reviewProposals.flatMap((proposal, proposalIndex) => proposal.candidate.proposed_nodes.map((item, index) => ({
    id: `preview:${proposal.id}:${item.client_key}`, type: "brand", draggable: false, selectable: false,
    position: { x: 460 + proposalIndex * 36, y: 80 + index * 164 }, data: { preview: true, record: { id: `preview:${item.client_key}`, project_id: initial.project.id, node_type: item.node_type, title: item.title, content: item.content, state: "working", created_by: "hermes", provenance: item.rationale, tags: [], version: 0, created_at: "", updated_at: "" } as GraphNode }, style: { width: 244, height: 124 },
  }))), [initial.project.id, reviewProposals]);
  const displayedNodes = useMemo(() => [...canvasVisibleNodes, ...previewNodes], [canvasVisibleNodes, previewNodes]);
  const previewEdges = useMemo(() => reviewProposals.flatMap((proposal) => {
    const proposedKeys = new Set(proposal.candidate.proposed_nodes.map((node) => node.client_key));
    const endpoint = (key: string) => proposedKeys.has(key) ? `preview:${proposal.id}:${key}` : key;
    return proposal.candidate.proposed_edges.map((edge, index) => ({ id: `preview-edge:${proposal.id}:${index}`, source: endpoint(edge.source_key), target: endpoint(edge.target_key), type: "semantic", selectable: false, data: { edgeType: edge.edge_type, preview: true }, style: { opacity: .65 } } as Edge));
  }), [reviewProposals]);
  const displayedEdges = useMemo(() => [...visibleEdges, ...previewEdges], [previewEdges, visibleEdges]);
  const performanceMode = useMemo(() => projectGraphPerformanceMode({ nodeCount: visibleNodes.length, edgeCount: graph.semantic.edges.length, zoom: viewport.zoom }), [graph.semantic.edges.length, viewport.zoom, visibleNodes.length]);
  const selectedConnections = useMemo(() => selectedNode ? graph.semantic.edges.filter((edge) => edge.source_node_id === selectedNode.id || edge.target_node_id === selectedNode.id).map((edge) => {
    const other = graph.semantic.nodes.find((node) => node.id === (edge.source_node_id === selectedNode.id ? edge.target_node_id : edge.source_node_id));
    return { id: edge.id, label: `${edge.edge_type.replaceAll("_", " ")} ${other?.title ?? "Unknown node"}` };
  }) : [], [graph.semantic.edges, graph.semantic.nodes, selectedNode]);
  const selectedChallengeDependencies = useMemo(() => selectedNode?.challenge_dependencies?.length
    ? selectedNode.challenge_dependencies.map((id) => graph.semantic.nodes.find((node) => node.id === id)?.title ?? id)
    : selectedConnections.map((connection) => connection.label), [graph.semantic.nodes, selectedConnections, selectedNode]);
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
  const applyAnnotationChange = useCallback(async (
    before: readonly CanvasAnnotation[],
    after: readonly CanvasAnnotation[],
    cleanup: readonly { media_id: string; upload_claim: string }[] = [],
  ) => {
    setAnnotationError("");
    await persistAnnotations(after, cleanup);
    annotationDispatch({ type: "replace", annotations: after });
    recordHistory({ domain: "annotation", before, after });
  }, [persistAnnotations, recordHistory]);

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
    const idempotencyKey = crypto.randomUUID(); let expectedVersion = projectVersionRef.current;
    const operation = semanticQueue.current.catch(() => undefined).then(async () => {
      expectedVersion = projectVersionRef.current; const saved = await api.createNode(initial.project.id, { node_type: "idea", title: "New thought", content: "Captured on canvas.", created_by: "user", provenance: "Canvas quick capture", tags: [], expected_project_version: expectedVersion }, idempotencyKey);
        projectVersionRef.current += 1;
        persistedNodeIds.current.add(saved.id);
        setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === optimistic.id ? saved : item) } }));
        setLayoutSave("saving");
        setFlowNodes((current) => {
          const next = current.map((item) => item.id === optimistic.id ? { ...item, id: saved.id, data: { record: saved } } : item);
          saveLayout(next); return next;
        });
        recordHistory({ domain: "graph", command: { kind: "node", node: saved } });
    });
    semanticQueue.current = operation.then(() => undefined, () => undefined);
    void operation.then(() => { if (semanticGeneration.current === generation) setSemanticSave("saved"); }).catch((error: unknown) => {
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.filter((item) => item.id !== optimistic.id) } }));
      setFlowNodes((current) => current.filter((item) => item.id !== optimistic.id));
      if (semanticGeneration.current === generation) setSemanticSave("attention");
      const queued = queuePendingEdit("create_node", expectedVersion, { input: { node_type: "idea", title: "New thought", content: "Captured on canvas.", created_by: "user", provenance: "Canvas quick capture", tags: [] } }, idempotencyKey, error);
      if (queued) setSemanticError("New thought was not saved. Recovery queued locally.");
      else if (classifyPendingFailure(error) !== "retryable") setSemanticError("New thought was rejected. Check access and values, then try again in this tab.");
    });
  }, [api, initial, instance, queuePendingEdit, recordHistory, saveLayout, user]);

  const createRelationship = useCallback((connection: Connection, edgeType: EdgeType = "supports") => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const now = new Date().toISOString();
    const optimistic: GraphEdge = { id: crypto.randomUUID(), project_id: initial.project.id, source_node_id: connection.source,
      target_node_id: connection.target, edge_type: edgeType, label: null, version: 1, created_at: now, updated_at: now };
    setGraph((current) => replaceSemantic(current, { ...current.semantic, edges: [...current.semantic.edges, optimistic] }));
    setSemanticSave("saving"); setSemanticError("");
    const generation = ++semanticGeneration.current;
    const idempotencyKey = crypto.randomUUID(); let expectedVersion = projectVersionRef.current;
    const operation = semanticQueue.current.catch(() => undefined).then(async () => {
      expectedVersion = projectVersionRef.current;
      const saved = await api.createEdge(initial.project.id, { source_node_id: connection.source, target_node_id: connection.target, edge_type: edgeType,
      label: null, expected_project_version: expectedVersion }, idempotencyKey);
      projectVersionRef.current += 1;
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: current.semantic.edges.map((item) => item.id === optimistic.id ? saved : item) } }));
      recordHistory({ domain: "graph", command: { kind: "edge", edge: saved } });
    });
    semanticQueue.current = operation.then(() => undefined, () => undefined);
    return operation.then(() => { if (semanticGeneration.current === generation) setSemanticSave("saved"); }).catch((error: unknown) => {
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: current.semantic.edges.filter((item) => item.id !== optimistic.id) } }));
      if (semanticGeneration.current === generation) setSemanticSave("attention");
      const queued = queuePendingEdit("create_edge", expectedVersion, { input: { source_node_id: connection.source, target_node_id: connection.target, edge_type: edgeType, label: null } }, idempotencyKey, error);
      if (queued) setSemanticError("Relationship was not saved. Recovery queued locally.");
      else if (classifyPendingFailure(error) !== "retryable") setSemanticError("Relationship was rejected. Check access and endpoints, then retry.");
      throw error;
    });
  }, [api, initial.project.id, queuePendingEdit, recordHistory]);
  const connect = useCallback((connection: Connection) => { void createRelationship(connection)?.catch(() => undefined); }, [createRelationship]);

  const finishDraw = useCallback(() => {
    if (currentPoints.length < 2 || !user) { setCurrentPoints([]); return; }
    const now = new Date().toISOString();
    const mark: CanvasAnnotation = { id: crypto.randomUUID(), project_id: initial.project.id, owner_id: user.id, annotation_type: "freehand",
      path_points: currentPoints, color: "#74432f", media_id: null, version: 1, created_at: now, updated_at: now };
    const before = annotations.annotations; const next = [...before, mark];
    setCurrentPoints([]); void applyAnnotationChange(before, next).catch(() => setAnnotationError("Annotation was not saved. Draw again to retry."));
  }, [annotations.annotations, applyAnnotationChange, currentPoints, initial.project.id, user]);

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
      await applyAnnotationChange(annotations.annotations, next, [{ media_id: uploaded.id, upload_claim: uploaded.upload_claim }]);
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
  }, [annotations.annotations, api, applyAnnotationChange, initial.project.id, user]);

  const captureDraft = useCallback(async (draft: CaptureDraft) => {
    if (!user) throw new Error("authentication_required");
    setCaptureBusy(true); setSemanticSave("saving"); setSemanticError("");
    const now = new Date().toISOString();
    const optimistic: GraphNode = { id: crypto.randomUUID(), project_id: initial.project.id, ...draft, state: "working", created_by: "user", provenance: "Quick capture", tags: [], version: 1, created_at: now, updated_at: now };
    const position = instance?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 320, y: 240 };
    const idempotencyKey = crypto.randomUUID(); let expectedVersion = projectVersionRef.current;
    setGraph((current) => quickCapture(current, optimistic));
    setFlowNodes((current) => [...current, { ...toFlowNode(initial, optimistic, current.length), position }]);
    try {
      const saved = await enqueueSemantic(() => { expectedVersion = projectVersionRef.current; return api.createNode(initial.project.id, { ...draft, created_by: "user", provenance: "Quick capture", tags: [], expected_project_version: expectedVersion }, idempotencyKey).then((value) => { projectVersionRef.current += 1; return value; }); });
      persistedNodeIds.current.add(saved.id);
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === optimistic.id ? saved : item) } }));
      setFlowNodes((current) => { const next = current.map((item) => item.id === optimistic.id ? { ...item, id: saved.id, data: { record: saved } } : item); saveLayout(next); return next; });
      recordHistory({ domain: "graph", command: { kind: "node", node: saved } });
      setSemanticSave("saved");
    } catch (error) {
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.filter((item) => item.id !== optimistic.id) } }));
      setFlowNodes((current) => current.filter((item) => item.id !== optimistic.id)); queuePendingEdit("create_node", expectedVersion, { input: { ...draft, created_by: "user", provenance: "Quick capture", tags: [] } }, idempotencyKey, error); setSemanticSave("attention"); throw error;
    } finally { setCaptureBusy(false); }
  }, [api, enqueueSemantic, initial, instance, queuePendingEdit, recordHistory, saveLayout, user]);

  const saveInspectedNode = useCallback(async (input: NodeUpdateInput) => {
    if (!selectedNode || !user) return;
    const nodeId = selectedNode.id;
    let expected = projectVersionRef.current; const idempotencyKey = crypto.randomUUID();
    try {
      const saved = await enqueueSemantic(() => { expected = projectVersionRef.current; return api.updateNode(initial.project.id, nodeId, { ...input, expected_project_version: expected }, idempotencyKey).then((value) => { projectVersionRef.current += 1; return value; }); });
      if (saved.state === "trash") { setTrashedNodes((current) => [...current.filter((item) => item.id !== saved.id), saved]); setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.filter((item) => item.id !== saved.id) } })); setFlowNodes((current) => current.filter((item) => item.id !== saved.id)); setSelectedNodeId(null); }
      else { setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === saved.id ? saved : item) } })); setFlowNodes((current) => current.map((item) => item.id === saved.id ? { ...item, data: { record: saved } } : item)); }
      setRevisions(await api.listNodeRevisions(initial.project.id, saved.id));
      const refreshed = await api.loadProject(initial.project.id); const live = refreshed.nodes.filter((item) => item.state !== "trash"); const liveIds = new Set(live.map((item) => item.id)); const byId = new Map(live.map((item) => [item.id, item]));
      projectVersionRef.current = refreshed.project.version; setGraph(createGraphState(live, refreshed.edges.filter((edge) => liveIds.has(edge.source_node_id) && liveIds.has(edge.target_node_id)))); setFlowNodes((current) => current.filter((item) => byId.has(item.id)).map((item) => ({ ...item, data: { record: byId.get(item.id)! } }))); setTrashedNodes(refreshed.nodes.filter((item) => item.state === "trash")); setConflict(null);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "version_conflict") {
        const loaded = await api.loadProject(initial.project.id); const latest = loaded.nodes.find((item) => item.id === nodeId);
        if (latest) { projectVersionRef.current = loaded.project.version; setConflict({ nodeId, submitted: input, latest, latestProject: loaded.project, submittedVersion: expected }); }
      } else {
        const queued = queuePendingEdit("update_node", expected, { nodeId, input }, idempotencyKey, error);
        setSemanticSave("attention"); if (queued) setSemanticError("Edit queued locally. Draft preserved; reconnect to retry.");
        else if (classifyPendingFailure(error) !== "retryable") setSemanticError("Edit was rejected. Check access and values; your in-tab draft remains available.");
      }
      throw error;
    }
  }, [api, enqueueSemantic, initial.project.id, queuePendingEdit, selectedNode, user]);

  const applyHeldRecovery = useCallback(async (edit: PendingProjectEdit) => {
    if (edit.operation !== "update_node" || typeof edit.payload.nodeId !== "string" || !edit.payload.input || typeof edit.payload.input !== "object") throw new Error("held_recovery_unsupported");
    setSemanticSave("saving"); setSemanticError("");
    try {
      const latest = await api.loadProject(initial.project.id); const node = latest.nodes.find((item) => item.id === edit.payload.nodeId); if (!node) throw new Error("held_recovery_node_missing");
      projectVersionRef.current = latest.project.version;
      const input = edit.payload.input as NodeUpdateInput; const saved = await api.updateNode(initial.project.id, node.id, { ...input, expected_node_version: node.version, expected_project_version: latest.project.version }, crypto.randomUUID());
      projectVersionRef.current += 1;
      setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === saved.id ? saved : item) } }));
      setFlowNodes((current) => current.map((item) => ({ ...item, selected: item.id === saved.id, data: item.id === saved.id ? { record: saved } : item.data })));
      setSelectedNodeId(saved.id); setInspectorEpoch((value) => value + 1); setInspectorFocusRequest(crypto.randomUUID());
      setHeldTerminalEdits((current) => current.filter((item) => item.idempotencyKey !== edit.idempotencyKey)); setSemanticSave("saved"); setSemanticError("Recovered edit saved against latest project state.");
    } catch (error) { setSemanticSave("attention"); setSemanticError("Recovered edit was not saved. Held recovery remains in this tab."); throw error; }
  }, [api, initial.project.id]);

  const connectInspectedNode = useCallback(async (targetId: string, edgeType: EdgeType) => {
    if (!selectedNode) return;
    const idempotencyKey = crypto.randomUUID(); let expectedVersion = projectVersionRef.current;
    setSemanticSave("saving"); const operation = semanticQueue.current.catch(() => undefined).then(async () => {
      expectedVersion = projectVersionRef.current; const saved = await api.createEdge(initial.project.id, { source_node_id: selectedNode.id, target_node_id: targetId, edge_type: edgeType, label: null, expected_project_version: expectedVersion }, idempotencyKey);
      projectVersionRef.current += 1; setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: [...current.semantic.edges, saved] } }));
    });
    semanticQueue.current = operation.then(() => undefined, () => undefined);
    try { await operation; setSemanticSave("saved"); } catch (error) { queuePendingEdit("create_edge", expectedVersion, { input: { source_node_id: selectedNode.id, target_node_id: targetId, edge_type: edgeType, label: null } }, idempotencyKey, error); setSemanticSave("attention"); throw error; }
  }, [api, initial.project.id, queuePendingEdit, selectedNode]);

  const refreshSemantic = useCallback(async () => {
    const loaded = await api.loadProject(initial.project.id); const live = loaded.nodes.filter((node) => node.state !== "trash"); const ids = new Set(live.map((node) => node.id));
    projectVersionRef.current = loaded.project.version; setGraph(createGraphState(live, loaded.edges.filter((edge) => ids.has(edge.source_node_id) && ids.has(edge.target_node_id))));
    setFlowNodes(live.map((node, index) => toFlowNode(loaded, node, index))); setTrashedNodes(loaded.nodes.filter((node) => node.state === "trash"));
  }, [api, initial.project.id]);

  const restoreTrashedNode = useCallback(async (node: GraphNode) => {
    const restored = await enqueueSemantic(async () => { const value = await api.restoreNode(initial.project.id, node.id, node.version, projectVersionRef.current, crypto.randomUUID()); projectVersionRef.current += 1; return value; });
    setTrashedNodes((current) => current.filter((item) => item.id !== restored.id));
    setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: [...current.semantic.nodes, restored] } }));
    setFlowNodes((current) => [...current, toFlowNode(initial, restored, current.length)]); setSemanticSave("saved");
  }, [api, enqueueSemantic, initial]);

  const applyPendingEdit = useCallback(async (edit: PendingProjectEdit) => {
    try {
      if (edit.operation === "update_node" && typeof edit.payload.nodeId === "string") {
        const input = edit.payload.input as NodeUpdateInput;
        const saved = await api.updateNode(initial.project.id, edit.payload.nodeId, { ...input, expected_project_version: edit.expectedVersion }, edit.idempotencyKey);
        setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === saved.id ? saved : item) } }));
        setFlowNodes((current) => current.map((item) => item.id === saved.id ? { ...item, data: { record: saved } } : item));
      } else if (edit.operation === "create_node") await api.createNode(initial.project.id, { ...(edit.payload.input as import("../../lib/project-types").NodeCreateInput), expected_project_version: edit.expectedVersion }, edit.idempotencyKey);
      else if (edit.operation === "create_edge") await api.createEdge(initial.project.id, { ...(edit.payload.input as import("../../lib/project-types").EdgeCreateInput), expected_project_version: edit.expectedVersion }, edit.idempotencyKey);
      else if (edit.operation === "delete_edge" && typeof edit.payload.edgeId === "string" && typeof edit.payload.edgeVersion === "number") await api.deleteEdge(initial.project.id, edit.payload.edgeId, edit.payload.edgeVersion, edit.expectedVersion, edit.idempotencyKey);
      else if (edit.operation === "trash_node" && typeof edit.payload.nodeId === "string" && typeof edit.payload.nodeVersion === "number") await api.trashNode(initial.project.id, edit.payload.nodeId, edit.payload.nodeVersion, edit.expectedVersion, edit.idempotencyKey);
      else if (edit.operation === "restore_node" && typeof edit.payload.nodeId === "string" && typeof edit.payload.nodeVersion === "number") await api.restoreNode(initial.project.id, edit.payload.nodeId, edit.payload.nodeVersion, edit.expectedVersion, edit.idempotencyKey);
      else if (edit.operation === "accept_proposal" && typeof edit.payload.proposalId === "string") await api.acceptProposal(initial.project.id, edit.payload.proposalId, edit.expectedVersion, edit.idempotencyKey);
      else if (edit.operation === "reject_proposal" && typeof edit.payload.proposalId === "string") await api.rejectProposal(initial.project.id, edit.payload.proposalId, edit.idempotencyKey);
      else if (edit.operation === "resolve_challenge" && typeof edit.payload.nodeId === "string" && typeof edit.payload.state === "string" && typeof edit.payload.note === "string") await api.resolveChallenge(initial.project.id, edit.payload.nodeId, edit.payload.state as "acknowledged" | "resolved" | "deferred" | "overridden", edit.payload.note, edit.expectedVersion, edit.idempotencyKey);
      else return { kind: "terminal" as const, code: "invalid_legacy_record" };
      if (edit.operation !== "reject_proposal") projectVersionRef.current += 1;
      return { kind: "success" as const };
    } catch (error) { return { kind: classifyPendingFailure(error), status: error instanceof ApiClientError ? error.status : undefined, code: error instanceof ApiClientError ? error.code : undefined }; }
  }, [api, initial.project.id]);
  useEffect(() => {
    if (!user) return;
    const replay = () => { if (terminalRecovery) return; void replayPendingEdits(pendingStore, user.id, initial.project.id, applyPendingEdit).then((result) => {
      if (result.replayed) { setSemanticSave("saved"); void refreshSemantic(); }
      if (result.conflict) {
        setSemanticError("Pending edit conflicts with latest project version. Review before retrying.");
        if (result.conflict.operation === "update_node" && typeof result.conflict.payload.nodeId === "string") void api.loadProject(initial.project.id).then((loaded) => {
          projectVersionRef.current = loaded.project.version; const latest = loaded.nodes.find((item) => item.id === result.conflict!.payload.nodeId);
          if (latest) setConflict({ nodeId: latest.id, submitted: result.conflict!.payload.input as NodeUpdateInput, latest, latestProject: loaded.project, submittedVersion: result.conflict!.expectedVersion, pending: result.conflict! });
        });
        else void api.loadProject(initial.project.id).then(async (latest) => {
          projectVersionRef.current = latest.project.version;
          const values = await hydratePendingConflict(result.conflict!, latest, () => api.listProposals(initial.project.id), (nodeId) => api.listChallengeResolutions(initial.project.id, nodeId));
          setGenericConflict({ edit: result.conflict!, latest, values });
        }).catch(() => { setSemanticSave("attention"); setSemanticError("Latest conflict values could not be loaded. Pending recovery remains queued."); });
      }
      if (result.clearFailed) { setSemanticSave("attention"); setSemanticError("Saved edit could not be cleared from local recovery. Replay paused; allow browser storage and retry."); }
      if (result.terminal) { setSemanticSave("attention"); setSemanticError("A stored edit is no longer valid and was not retried."); setTerminalRecovery({ edit: result.terminal.edit, category: result.terminal.code ?? `HTTP ${result.terminal.status ?? "error"}` }); }
      if (result.retryableFailure) { setSemanticSave("attention"); setSemanticError("Local recovery is still waiting for the project service. It remains stored for retry."); }
      if (result.readFailed && unstoredEdits.length) { setSemanticSave("attention"); setSemanticError("Not stored—keep this tab open. Local recovery is unavailable."); }
    }); };
    const retryUnstored = () => setUnstoredEdits((current) => current.filter((edit) => !pendingStore.enqueue(edit)));
    if (navigator.onLine) { retryUnstored(); replay(); } window.addEventListener("online", retryUnstored); window.addEventListener("online", replay); return () => { window.removeEventListener("online", retryUnstored); window.removeEventListener("online", replay); };
  }, [api, applyPendingEdit, initial.project.id, pendingStore, refreshSemantic, replayGeneration, terminalRecovery, unstoredEdits.length, user]);

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
    const idempotencyKey = crypto.randomUUID(); let expectedVersion = projectVersionRef.current;
    try { const accepted = await enqueueSemantic(() => { expectedVersion = projectVersionRef.current; return api.acceptProposal(initial.project.id, proposalId, expectedVersion, idempotencyKey).then((value) => { projectVersionRef.current += 1; return value; }); }); accepted.nodes.forEach((node) => persistedNodeIds.current.add(node.id)); setGraph((current) => acceptProposalResult(current, accepted)); setFlowNodes((current) => { const ids = new Set(current.map((node) => node.id)); return [...current.filter((node) => !node.id.startsWith(`preview:${proposalId}:`)), ...accepted.nodes.filter((node) => !ids.has(node.id)).map((node, index) => toFlowNode(initial, node, current.length + index))]; }); setProposals((items) => items.filter((item) => item.id !== proposalId)); }
    catch (error) {
      if (error instanceof ApiClientError && error.code === "version_conflict") { await enqueueSemantic(refreshSemantic).catch(() => undefined); setProposalError("Project changed elsewhere. Latest version loaded; review proposal and retry."); }
      else { queuePendingEdit("accept_proposal", expectedVersion, { proposalId }, idempotencyKey, error); setProposalError("Proposal was not applied. Graph remains unchanged; retry."); }
    } finally { setProposalBusy(false); }
  }, [api, enqueueSemantic, initial, queuePendingEdit, refreshSemantic]);

  const rejectProposal = useCallback(async (proposalId: string) => {
    setProposalBusy(true); setProposalError("");
    const idempotencyKey = crypto.randomUUID();
    try { await enqueueSemantic(() => api.rejectProposal(initial.project.id, proposalId, idempotencyKey)); setProposals((items) => items.filter((item) => item.id !== proposalId)); setDismissedProposals((current) => new Set(current).add(proposalId)); }
    catch (error) { queuePendingEdit("reject_proposal", projectVersionRef.current, { proposalId }, idempotencyKey, error); setProposalError("Proposal rejection failed. Preview retained for retry."); }
    finally { setProposalBusy(false); }
  }, [api, enqueueSemantic, initial.project.id, queuePendingEdit]);

  const resolveChallenge = useCallback(async (state: "acknowledged" | "resolved" | "deferred" | "overridden", note: string) => {
    if (!selectedNode) return; const nodeId = selectedNode.id;
    const idempotencyKey = crypto.randomUUID(); let expectedVersion = projectVersionRef.current;
    try { const saved = await enqueueSemantic(() => { expectedVersion = projectVersionRef.current; return api.resolveChallenge(initial.project.id, nodeId, state, note, expectedVersion, idempotencyKey).then((value) => { projectVersionRef.current += 1; return value; }); }); setChallengeResolutions((current) => ({ ...current, [nodeId]: [saved, ...(current[nodeId] ?? []).filter((item) => item.id !== saved.id)] })); }
    catch (error) { if (!(error instanceof ApiClientError && error.code === "version_conflict")) queuePendingEdit("resolve_challenge", expectedVersion, { nodeId, state, note }, idempotencyKey, error); throw error; }
  }, [api, enqueueSemantic, initial.project.id, queuePendingEdit, selectedNode]);

  const onSelectionChange = useCallback(({ nodes, edges }: OnSelectionChangeParams) => { setSelectionCount(nodes.length + edges.length); setSelectedNodeId(nodes.length === 1 ? nodes[0].id : null); }, []);
  const selectGraphNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId); setSelectionCount(1);
    setFlowNodes((items) => items.map((item) => ({ ...item, selected: item.id === nodeId })));
  }, []);
  const moveGraphNode = useCallback((nodeId: string, direction: "left" | "right" | "up" | "down") => {
    const delta = { left: [-24, 0], right: [24, 0], up: [0, -24], down: [0, 24] }[direction];
    const next = flowNodesRef.current.map((node) => node.id === nodeId ? { ...node, position: { x: node.position.x + delta[0], y: node.position.y + delta[1] } } : node);
    flowNodesRef.current = next; setLayoutSave("saving"); setFlowNodes(next); saveLayout(next);
  }, [saveLayout]);
  const connectGraphNodes = useCallback(async (sourceId: string, targetId: string, edgeType: EdgeType) => {
    await createRelationship({ source: sourceId, target: targetId, sourceHandle: null, targetHandle: null }, edgeType);
  }, [createRelationship]);
  const setViewport = useCallback((next: Viewport) => {
    setViewportState((current) => Math.floor(current.zoom * 10) === Math.floor(next.zoom * 10) ? current : { ...current, zoom: next.zoom }); let storage: Storage | null = null;
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
  const promoteBranch = useCallback((branch: string) => {
    const decisions = graph.semantic.nodes.filter((node) => node.node_type === "decision" && node.state === "working" && node.tags.includes(`branch:${branch}`));
    setSemanticSave("saving"); void enqueueSemantic(async () => {
      const response = await api.promoteBranch(initial.project.id, branch, projectVersionRef.current,
        decisions.map((node) => ({ node_id: node.id, expected_node_version: node.version })), crypto.randomUUID());
      const saved = response.nodes; projectVersionRef.current = response.project_version;
      const byId = new Map(saved.map((node) => [node.id, node])); setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((node) => byId.get(node.id) ?? node) } })); setFlowNodes((current) => current.map((item) => byId.has(item.id) ? { ...item, data: { record: byId.get(item.id)! } } : item)); setSemanticSave("saved");
    }).catch(() => { setSemanticSave("attention"); setSemanticError(`Branch ${branch} was not promoted. Decisions remain unchanged.`); });
  }, [api, enqueueSemantic, graph.semantic.nodes, initial.project.id]);
  const resolveMedia = useCallback((mediaId: string) => api.resolveMediaUrl(initial.project.id, mediaId), [api, initial.project.id]);
  const commitHistory = useCallback((direction: "undo" | "redo", command: WorkspaceCommand) => {
    const current = workspaceHistoryRef.current;
    const withAuthoritativeCommand = direction === "undo"
      ? { past: [...current.past.slice(0, -1), command], future: current.future }
      : { past: current.past, future: [...current.future.slice(0, -1), command] };
    const next = direction === "undo" ? commitWorkspaceUndo(withAuthoritativeCommand) : commitWorkspaceRedo(withAuthoritativeCommand);
    setHistory(next); persistWorkspaceHistory(next);
  }, [persistWorkspaceHistory, setHistory]);
  const undoWorkspace = useCallback(async () => {
    if (workspaceHistoryBusy.current) return;
    const candidate = undoCandidate(workspaceHistoryRef.current); if (!candidate) return;
    workspaceHistoryBusy.current = true;
    if (candidate.action.domain === "annotation") {
      setAnnotationSave("saving"); setAnnotationError("");
      try {
        await persistAnnotations(candidate.action.before);
        commitHistory("undo", candidate);
        annotationDispatch({ type: "replace", annotations: candidate.action.before });
      } catch {
        setAnnotationSave("attention"); setAnnotationError("Annotation undo was not saved. Retry Undo.");
      }
      workspaceHistoryBusy.current = false;
      return;
    }
    let command: SemanticCommand = candidate.action.command;
    const idempotencyKey = crypto.randomUUID(); let expectedVersion = projectVersionRef.current;
    setSemanticSave("saving"); setSemanticError(""); const generation = ++semanticGeneration.current;
    try {
      await enqueueSemantic(async () => {
        if (command.kind === "node") {
          expectedVersion = projectVersionRef.current;
          const trashed = await api.trashNode(initial.project.id, command.node.id, command.node.version, expectedVersion, idempotencyKey);
          projectVersionRef.current += 1; command = { kind: "node", node: trashed };
          setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.filter((item) => item.id !== trashed.id) } }));
          setFlowNodes((current) => current.map((item) => item.id === trashed.id ? { ...item, data: { ...item.data, removing: true } } : item));
          if (!reducedMotion) await new Promise((resolve) => setTimeout(resolve, 120));
          setFlowNodes((current) => current.filter((item) => item.id !== trashed.id));
          setTrashedNodes((current) => [...current.filter((item) => item.id !== trashed.id), trashed]);
        } else {
          const edge = command.edge;
          expectedVersion = projectVersionRef.current;
          await api.deleteEdge(initial.project.id, edge.id, edge.version, expectedVersion, idempotencyKey);
          projectVersionRef.current += 1;
          setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: current.semantic.edges.filter((item) => item.id !== edge.id) } }));
        }
      });
      commitHistory("undo", { ...candidate, action: { domain: "graph", command } });
      if (semanticGeneration.current === generation) setSemanticSave("saved");
    } catch (error) {
      if (semanticGeneration.current === generation) setSemanticSave("attention");
      if (command.kind === "node") queuePendingEdit("trash_node", expectedVersion, { nodeId: command.node.id, nodeVersion: command.node.version }, idempotencyKey, error);
      else queuePendingEdit("delete_edge", expectedVersion, { edgeId: command.edge.id, edgeVersion: command.edge.version }, idempotencyKey, error);
      setSemanticError(classifyPendingFailure(error) === "retryable" ? "Graph undo needs attention. Retry Undo when connected." : "Graph undo was rejected. Review the latest project before retrying.");
    } finally {
      workspaceHistoryBusy.current = false;
    }
  }, [api, commitHistory, enqueueSemantic, initial.project.id, persistAnnotations, queuePendingEdit, reducedMotion]);
  const redoWorkspace = useCallback(async () => {
    if (workspaceHistoryBusy.current) return;
    const candidate = redoCandidate(workspaceHistoryRef.current); if (!candidate) return;
    workspaceHistoryBusy.current = true;
    if (candidate.action.domain === "annotation") {
      setAnnotationSave("saving"); setAnnotationError("");
      try {
        await persistAnnotations(candidate.action.after);
        commitHistory("redo", candidate);
        annotationDispatch({ type: "replace", annotations: candidate.action.after });
      } catch {
        setAnnotationSave("attention"); setAnnotationError("Annotation redo was not saved. Retry Redo.");
      }
      workspaceHistoryBusy.current = false;
      return;
    }
    let command: SemanticCommand = candidate.action.command;
    const idempotencyKey = crypto.randomUUID(); let expectedVersion = projectVersionRef.current;
    setSemanticSave("saving"); setSemanticError(""); const generation = ++semanticGeneration.current;
    try {
      await enqueueSemantic(async () => {
        if (command.kind === "node") {
          expectedVersion = projectVersionRef.current;
          const restored = await api.restoreNode(initial.project.id, command.node.id, command.node.version, expectedVersion, idempotencyKey);
          projectVersionRef.current += 1; command = { kind: "node", node: restored };
          setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: [...current.semantic.nodes, restored] } }));
          setFlowNodes((current) => [...current, toFlowNode(initial, restored, current.length)]);
          setTrashedNodes((current) => current.filter((item) => item.id !== restored.id));
        } else {
          expectedVersion = projectVersionRef.current;
          const restored = await api.createEdge(initial.project.id, { source_node_id: command.edge.source_node_id, target_node_id: command.edge.target_node_id,
            edge_type: command.edge.edge_type, label: command.edge.label, expected_project_version: expectedVersion }, idempotencyKey);
          projectVersionRef.current += 1; command = { kind: "edge", edge: restored };
          setGraph((current) => ({ ...current, semantic: { ...current.semantic, edges: [...current.semantic.edges, restored] } }));
        }
      });
      commitHistory("redo", { ...candidate, action: { domain: "graph", command } });
      if (semanticGeneration.current === generation) setSemanticSave("saved");
    } catch (error) {
      if (semanticGeneration.current === generation) setSemanticSave("attention");
      if (command.kind === "node") queuePendingEdit("restore_node", expectedVersion, { nodeId: command.node.id, nodeVersion: command.node.version }, idempotencyKey, error);
      else queuePendingEdit("create_edge", expectedVersion, { input: { source_node_id: command.edge.source_node_id, target_node_id: command.edge.target_node_id, edge_type: command.edge.edge_type, label: command.edge.label } }, idempotencyKey, error);
      setSemanticError(classifyPendingFailure(error) === "retryable" ? "Graph redo needs attention. Retry Redo when connected." : "Graph redo was rejected. Review the latest project before retrying.");
    } finally {
      workspaceHistoryBusy.current = false;
    }
  }, [api, commitHistory, enqueueSemantic, initial, persistAnnotations, queuePendingEdit]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const next = ({ v: "select", c: "connect", d: "draw", e: "erase" } as const)[event.key.toLowerCase() as "v"];
      if (next) { event.preventDefault(); setMode(next); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (graphView !== "canvas" || !selectedNodeId || isMobile) return;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(selectedNodeId)}"]`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [graphView, isMobile, selectedNodeId]);

  return <motion.section animate={{ opacity: 1 }} className="constellation-workspace workbench-motion" data-collapse-distant-clusters={collapseDistant || undefined} data-simplify-distant-nodes={(collapseDistant || performanceMode.simplifyDistantNodes) || undefined} data-theme={theme} initial={reducedMotion ? false : { opacity: .98 }} style={themeStyle} transition={{ duration: reducedMotion ? 0 : .14 }}>
    <EditorToolbar aria-label="Project toolbar" className="constellation-header"><div><p>Brand Constellation</p><h1>{initial.project.title}</h1></div>
      <div aria-live="polite" className="constellation-save"><span>{semanticStatus(semanticSave)}</span><span>{layoutStatus(layoutSave)}</span><span>{annotationStatus(annotationSave)}</span><span>{selectionCount} selected</span></div>
      <Link className="constellation-blueprint-link" href={`/projects/${encodeURIComponent(initial.project.id)}/blueprint`}>Blueprint</Link>
      <ThemeSelector busy={themeBusy} effectiveTheme={theme} globalTheme={globalTheme} projectTheme={projectTheme} onGlobalTheme={persistGlobalTheme} onProjectTheme={persistProjectTheme} /></EditorToolbar>
    {themeError && <p className="constellation-domain-error" role="alert">{themeError}</p>}
    {semanticError && <div className="constellation-domain-error" role="alert"><span>{semanticError}</span>{semanticError.startsWith("New thought") && <button onClick={addThought} type="button">Retry new thought</button>}</div>}
    {annotationError && <p className="constellation-domain-error" role="alert">{annotationError}</p>}
    {mediaRecovery && <div className="constellation-domain-error" role="alert"><span>{mediaRecovery.message}</span><button onClick={mediaRecovery.action} type="button">{mediaRecovery.actionLabel}</button></div>}
    {historyNotice && <p className="constellation-history-notice" role="status">{historyNotice}</p>}
    {visibleNodes.length >= 250 && <div className="constellation-history-notice" role="status"><span>{collapseDistant ? `${visibleNodes.length - canvasVisibleNodes.length} distant nodes collapsed for performance.` : "All distant clusters expanded."}</span><button type="button" onClick={() => setExpandDistantClusters((value) => !value)}>{expandDistantClusters ? "Collapse distant clusters" : "Expand distant clusters"}</button></div>}
    <div aria-label="Graph representation" className="constellation-view-switch"><button aria-pressed={graphView === "canvas"} onClick={() => setGraphView("canvas")} type="button">Canvas graph</button><button aria-pressed={graphView === "structured"} onClick={() => setGraphView("structured")} type="button">Structured graph</button></div>
    <div className="constellation-grid" data-work-panel={selectedNode || reviewProposals.length ? "open" : "closed"}>
      <ProjectMapPanel activeTypes={activeTypes} branches={tags(graph.semantic.nodes, "branch:")} clusters={tags(graph.semantic.nodes, "cluster:")} edges={graph.semantic.edges} nodes={graph.semantic.nodes} onPromote={promoteBranch}
        unresolvedOnly={unresolvedOnly} onFitSelection={fitSelection} onUnresolved={setUnresolvedOnly}
        onType={(type, enabled) => setActiveTypes((current) => { const next = new Set(current); if (enabled) next.add(type); else next.delete(type); return next; })} />
      {!isMobile && <div className={`constellation-canvas ${graphView === "structured" ? "constellation-canvas--hidden" : ""}`} data-testid="constellation-canvas" onPointerDown={(event) => {
        if (mode !== "draw" || !instance || (event.target as Element).closest(".react-flow__node, .canvas-toolbar, .react-flow__controls, .react-flow__minimap")) return;
        const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }); setCurrentPoints([[point.x, point.y]]);
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      }} onPointerMove={(event) => {
        if (mode !== "draw" || !instance || !currentPoints.length) return;
        const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }); setCurrentPoints((points) => [...points, [point.x, point.y]]);
      }} onPointerUp={finishDraw} tabIndex={0}>
        <ReactFlow ariaLabelConfig={ARIA_LABELS} autoPanOnNodeFocus edges={displayedEdges} edgeTypes={semanticEdgeTypes} elementsSelectable={mode === "select"}
          fitView multiSelectionKeyCode="Shift" nodes={displayedNodes} nodesConnectable={mode === "connect"} nodesFocusable nodesDraggable={mode === "select"}
          nodeTypes={brandNodeTypes} onConnect={connect} onInit={setInstance} onMove={(_, next) => setViewportState((current) => Math.floor(current.zoom * 10) === Math.floor(next.zoom * 10) ? current : { ...current, zoom: next.zoom })} onMoveEnd={(_, next) => setViewport(next)} onNodesChange={onNodesChange}
          onSelectionChange={onSelectionChange} panOnDrag={mode === "select" ? [1, 2] : false} panOnScroll selectionMode={SelectionMode.Partial} selectionOnDrag={mode === "select"}>
          <Background gap={24} size={1} /><Controls /><MiniMap ariaLabel="Constellation minimap" pannable zoomable />
        </ReactFlow>
        <ViewportLayers annotations={annotations.annotations} currentPoints={currentPoints} mode={mode} onAction={(action) => {
          const next = reduceAnnotationAction(annotations, action);
          void applyAnnotationChange(annotations.annotations, next.annotations).catch(() => setAnnotationError("Annotation erase was not saved. Try again."));
        }} resolveMedia={resolveMedia} />
        <CanvasToolbar mode={mode} onMode={setMode} onAddThought={addThought} onAddMedia={() => fileRef.current?.click()}
          nodes={graph.semantic.nodes.map((node) => ({ id: node.id, title: node.title }))}
          onConnectNodes={(source, target) => connect({ source, target, sourceHandle: null, targetHandle: null })} onResizeNode={resizeNode}
          onUndoGraph={() => { void undoWorkspace(); }} onRedoGraph={() => { void redoWorkspace(); }}
          onUndoAnnotations={() => { void undoWorkspace(); }}
          onRedoAnnotations={() => { void redoWorkspace(); }} />
        <input accept="image/jpeg,image/png,image/webp" aria-label="Choose media" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void addMedia(file); }} ref={fileRef} type="file" />
      </div>}
      {!isMobile && graphView === "structured" && <div className="constellation-structured constellation-structured--visible">
        <AccessibleGraph active={graphView === "structured"} edges={graph.semantic.edges} nodes={graph.semantic.nodes} selectedNodeId={selectedNodeId} onConnect={connectGraphNodes} onCreate={addThought} onMove={moveGraphNode} onSelect={selectGraphNode} />
      </div>}
      {isMobile && <MobileGraphNavigator edges={graph.semantic.edges} nodes={graph.semantic.nodes} selectedNodeId={selectedNodeId} onSelect={selectGraphNode} />}
      <WorkBenchMotionPanel reducedMotion={Boolean(reducedMotion)}>
        {terminalRecovery && <TerminalRecoveryPanel category={terminalRecovery.category} edit={terminalRecovery.edit} onDiscard={async () => { if (!user || !pendingStore.remove(user.id, initial.project.id, terminalRecovery.edit.idempotencyKey)) throw new Error("recovery_remove_failed"); setTerminalRecovery(null); setSemanticError("Local recovery discarded. Later stored edits can continue."); setReplayGeneration((value) => value + 1); }} onKeepInTab={async () => { if (!user || !pendingStore.remove(user.id, initial.project.id, terminalRecovery.edit.idempotencyKey)) throw new Error("recovery_remove_failed"); setHeldTerminalEdits((current) => [...current.filter((item) => item.idempotencyKey !== terminalRecovery.edit.idempotencyKey), terminalRecovery.edit]); setTerminalRecovery(null); setSemanticError("Held in this tab—edit and save manually. Later stored edits can continue."); setReplayGeneration((value) => value + 1); }} />}
        {heldTerminalEdits.length > 0 && <HeldRecoveryPanel edits={heldTerminalEdits} onApply={applyHeldRecovery} onDiscard={async (edit) => { setHeldTerminalEdits((current) => current.filter((item) => item.idempotencyKey !== edit.idempotencyKey)); setSemanticError("In-tab recovery discarded."); }} />}
        {genericConflict && <ConflictPanel submitted={{ operation: genericConflict.edit.operation, ...genericConflict.edit.payload }} latest={genericConflict.values} submittedVersion={genericConflict.edit.expectedVersion} latestVersion={genericConflict.latest.project.version}
          onAcceptLatest={() => { if (!user || !pendingStore.remove(user.id, initial.project.id, genericConflict.edit.idempotencyKey)) { setSemanticSave("attention"); return; } setGenericConflict(null); void refreshSemantic(); }}
          onClose={() => setGenericConflict(null)} onKeepMine={async () => { if (!user) return; const old = genericConflict.edit; let payload = old.payload; if ((old.operation === "trash_node" || old.operation === "restore_node") && typeof payload.nodeId === "string") { const item = genericConflict.latest.nodes.find((node) => node.id === payload.nodeId); if (item) payload = { ...payload, nodeVersion: item.version }; } if (old.operation === "delete_edge" && typeof payload.edgeId === "string") { const item = genericConflict.latest.edges.find((edge) => edge.id === payload.edgeId); if (item) payload = { ...payload, edgeVersion: item.version }; } const retry = { ...old, payload, expectedVersion: genericConflict.latest.project.version, idempotencyKey: crypto.randomUUID(), createdAt: Date.now() }; if ((await applyPendingEdit(retry)).kind !== "success") throw new Error("retry_conflict"); if (!pendingStore.remove(user.id, initial.project.id, old.idempotencyKey)) { setSemanticSave("attention"); throw new Error("recovery_clear_failed"); } setGenericConflict(null); void refreshSemantic(); }} />}
        {conflict && <ConflictPanel submitted={conflict.submitted} latest={{ project: conflict.latestProject, node: conflict.latest }} submittedVersion={conflict.submittedVersion} latestVersion={projectVersionRef.current}
          onAcceptLatest={() => { const latest = conflict.latest; if (conflict.pending && user && !pendingStore.remove(user.id, initial.project.id, conflict.pending.idempotencyKey)) { setSemanticSave("attention"); setSemanticError("Latest version selected, but pending recovery could not be cleared. Allow browser storage and retry."); return; } setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === latest.id ? latest : item) } })); setFlowNodes((current) => current.map((item) => item.id === latest.id ? { ...item, data: { record: latest } } : item)); setInspectorEpoch((value) => value + 1); setInspectorFocusRequest(crypto.randomUUID()); setConflict(null); setSemanticSave("saved"); }}
          onClose={() => setConflict(null)} onKeepMine={async () => { const latest = conflict.latest; const retryKey = crypto.randomUUID(); const saved = await api.updateNode(initial.project.id, conflict.nodeId, { ...conflict.submitted, expected_node_version: latest.version, expected_project_version: projectVersionRef.current }, retryKey); if (conflict.pending && user && !pendingStore.remove(user.id, initial.project.id, conflict.pending.idempotencyKey)) { setSemanticSave("attention"); setSemanticError("Retried edit saved, but old recovery record could not be cleared. Replay paused."); return; } projectVersionRef.current += 1; setGraph((current) => ({ ...current, semantic: { ...current.semantic, nodes: current.semantic.nodes.map((item) => item.id === saved.id ? saved : item) } })); setFlowNodes((current) => current.map((item) => item.id === saved.id ? { ...item, data: { record: saved } } : item)); setInspectorEpoch((value) => value + 1); setInspectorFocusRequest(crypto.randomUUID()); setConflict(null); setSemanticSave("saved"); }} />}
        {restoredAnalysis && <div className="constellation-panel" role="status"><strong>Analysis request restored</strong><p>Selection and analysis type are ready. Retry only when you choose.</p><div className="panel-actions"><button onClick={() => void runAnalysis()} type="button">Retry preserved analysis</button><button onClick={() => { try { sessionStorage.removeItem(`creative-curator:analysis-retry:${initial.project.id}`); } catch { /* optional */ } setRestoredAnalysis(null); }} type="button">Cancel preserved analysis</button></div></div>}
        <CommandSurface busy={captureBusy} onCapture={captureDraft} />
        {selectedNode && <section className="guided-analysis" aria-label="Guided exploration"><div><p>Hermes</p><h2>Guided exploration</h2></div><button disabled={analysisBusy} onClick={() => void runAnalysis()} type="button">{analysisBusy ? "Hermes is analyzing…" : "Explore selected node"}</button>
          {analysisScope.length > 0 && <div><h3>Relevant scope</h3><ul>{analysisScope.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {analysisError && <div role="alert"><p>{analysisError}</p>{analysisError.startsWith("AI configuration") ? <a href={`/settings?returnTo=${encodeURIComponent(`/projects/${initial.project.id}`)}`}>Open Settings</a> : <button onClick={() => void runAnalysis()} type="button">Retry analysis</button>}</div>}
        </section>}
        {proposalError && <p className="work-panel-error" role="alert">{proposalError}</p>}
        <ProposalTray accepting={proposalBusy} proposals={reviewProposals} onAccept={(id) => void acceptProposal(id)} onReject={(id) => void rejectProposal(id)} />
        <TrashedNodesPanel nodes={trashedNodes} onRestore={restoreTrashedNode} />
        {selectedNode?.node_type === "challenge" && <ChallengePanel challenge={selectedNode} dependencies={selectedChallengeDependencies} historyHref={`#challenge-resolution-history-${selectedNode.id}`} resolutions={challengeResolutions[selectedNode.id]} onResolve={resolveChallenge} />}
        {selectedNode?.node_type !== "challenge" && selectedNode && (challengeResolutions[selectedNode.id]?.length ?? 0) > 0 && <section className="constellation-panel" aria-label="Challenge resolution archive"><header><p>Immutable record</p><h2>Prior challenge resolutions</h2></header><ChallengeResolutionHistory historyHref={`#challenge-resolution-history-${selectedNode.id}`} nodeId={selectedNode.id} resolutions={challengeResolutions[selectedNode.id]} /></section>}
        {selectedNode && <NodeInspector availableNodes={graph.semantic.nodes} connections={selectedConnections} focusRequest={inspectorFocusRequest} key={`${selectedNode.id}:${inspectorEpoch}`} loadingRevisions={revisionsLoading} node={selectedNode} onConnect={connectInspectedNode} onFocusRequestHandled={(token) => setInspectorFocusRequest((current) => current === token ? null : current)} onSave={saveInspectedNode} revisions={revisions} />}
      </WorkBenchMotionPanel>
    </div>
  </motion.section>;
}

function WorkBenchMotionPanel({ children, reducedMotion }: { children: React.ReactNode; reducedMotion: boolean }) {
  return <WorkbenchPanel as={motion.aside} animate={{ opacity: 1 }} aria-label="Constellation work panel" className="constellation-work-panel"
    initial={reducedMotion ? false : { opacity: .96 }} transition={{ duration: reducedMotion ? 0 : .16 }}>{children}</WorkbenchPanel>;
}
