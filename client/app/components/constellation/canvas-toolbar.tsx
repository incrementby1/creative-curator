"use client";

import { Eraser, ImagePlus, Link2, MousePointer2, Pencil, Plus, Redo2, Undo2 } from "lucide-react";
import type { CanvasMode } from "./annotation-layer";

const MODES: Array<{ mode: CanvasMode; label: string; icon: typeof MousePointer2 }> = [
  { mode: "select", label: "Select", icon: MousePointer2 }, { mode: "connect", label: "Connect", icon: Link2 },
  { mode: "draw", label: "Draw", icon: Pencil }, { mode: "erase", label: "Erase", icon: Eraser },
];

export function CanvasToolbar({ mode, onMode, onAddThought, onAddMedia, onUndoGraph, onRedoGraph, onUndoAnnotations, onRedoAnnotations }: {
  mode: CanvasMode; onMode: (mode: CanvasMode) => void; onAddThought: () => void; onAddMedia: () => void;
  onUndoGraph: () => void; onRedoGraph: () => void; onUndoAnnotations: () => void; onRedoAnnotations: () => void;
}) {
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
  </div>;
}
