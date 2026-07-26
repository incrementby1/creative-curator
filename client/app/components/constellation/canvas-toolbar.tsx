"use client";

import { Eraser, ImagePlus, Link2, MousePointer2, Pencil, Plus, Redo2, Undo2 } from "lucide-react";
import { useState } from "react";
import type { CanvasMode } from "./annotation-layer";

const MODES: Array<{ mode: CanvasMode; label: string; icon: typeof MousePointer2 }> = [
  { mode: "select", label: "Select", icon: MousePointer2 }, { mode: "connect", label: "Connect", icon: Link2 },
  { mode: "draw", label: "Draw", icon: Pencil }, { mode: "erase", label: "Erase", icon: Eraser },
];

export function CanvasToolbar({ mode, onMode, onAddThought, onAddMedia, onUndoGraph, onRedoGraph, onUndoAnnotations, onRedoAnnotations, nodes, onConnectNodes, onResizeNode }: {
  mode: CanvasMode; onMode: (mode: CanvasMode) => void; onAddThought: () => void; onAddMedia: () => void;
  onUndoGraph: () => void; onRedoGraph: () => void; onUndoAnnotations: () => void; onRedoAnnotations: () => void;
  nodes: readonly { id: string; title: string }[]; onConnectNodes: (source: string, target: string) => void;
  onResizeNode: (id: string, width: number, height: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(""); const [target, setTarget] = useState(""); const [resizeId, setResizeId] = useState("");
  const [width, setWidth] = useState(244); const [height, setHeight] = useState(124);
  return <div aria-label="Canvas tools" className="canvas-toolbar" role="toolbar">
    {MODES.map(({ mode: item, label, icon: Icon }) => <button aria-keyshortcuts={item === "select" ? "V" : item === "connect" ? "C" : item === "draw" ? "D" : "E"}
      aria-pressed={mode === item} key={item} onClick={() => onMode(item)} type="button"><Icon aria-hidden="true" />{label}</button>)}
    <span aria-hidden="true" />
    <button onClick={onAddThought} type="button"><Plus aria-hidden="true" />Add thought</button>
    <button onClick={onAddMedia} type="button"><ImagePlus aria-hidden="true" />Add media</button>
    <span aria-hidden="true" />
    <button aria-label="Undo graph" onClick={onUndoGraph} title="Undo graph" type="button"><Undo2 aria-hidden="true" /></button>
    <button aria-label="Redo graph" onClick={onRedoGraph} title="Redo graph" type="button"><Redo2 aria-hidden="true" /></button>
    <button aria-label="Undo annotations" onClick={onUndoAnnotations} title="Undo annotations" type="button"><Undo2 aria-hidden="true" /></button>
    <button aria-label="Redo annotations" onClick={onRedoAnnotations} title="Redo annotations" type="button"><Redo2 aria-hidden="true" /></button>
    <button aria-expanded={open} aria-controls="keyboard-graph-controls" onClick={() => setOpen((value) => !value)} type="button">Keyboard graph controls</button>
    {open && <div className="canvas-toolbar__keyboard" id="keyboard-graph-controls">
      <fieldset><legend>Connect nodes</legend><label>Connection source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Choose source</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        <label>Connection target<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Choose target</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        <button disabled={!source || !target || source === target} onClick={() => onConnectNodes(source, target)} type="button">Create relationship</button></fieldset>
      <fieldset><legend>Resize node</legend><label>Node to resize<select value={resizeId} onChange={(event) => setResizeId(event.target.value)}><option value="">Choose node</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        <label>Node width<input min="208" max="1200" type="number" value={width} onChange={(event) => setWidth(event.target.valueAsNumber)} /></label>
        <label>Node height<input min="112" max="900" type="number" value={height} onChange={(event) => setHeight(event.target.valueAsNumber)} /></label>
        <button disabled={!resizeId || !Number.isFinite(width) || !Number.isFinite(height)} onClick={() => onResizeNode(resizeId, width, height)} type="button">Apply node size</button></fieldset>
    </div>}
  </div>;
}
