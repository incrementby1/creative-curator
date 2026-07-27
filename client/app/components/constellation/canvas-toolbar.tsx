"use client";

import { Eraser, ImagePlus, Link2, MousePointer2, Pencil, Plus, Redo2, Undo2 } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CanvasMode } from "./annotation-layer";

const MODES = [
  { mode: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
  { mode: "connect", label: "Connect", shortcut: "C", icon: Link2 },
  { mode: "draw", label: "Draw", shortcut: "D", icon: Pencil },
  { mode: "erase", label: "Erase", shortcut: "E", icon: Eraser },
] as const satisfies ReadonlyArray<{ mode: CanvasMode; label: string; shortcut: string; icon: typeof MousePointer2 }>;

type CanvasToolbarProps = Readonly<{
  mode: CanvasMode;
  canUndo: boolean;
  canRedo: boolean;
  onMode: (mode: CanvasMode) => void;
  onAddThought: () => void;
  onAddMedia: () => void;
  onUndo: () => void;
  onRedo: () => void;
}>;

function ToolButton({ label, children, ...props }: Readonly<{
  label: string;
  children: ReactNode;
}> & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">) {
  const tooltipId = `${useId()}-tooltip`;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [escapeDismissed, setEscapeDismissed] = useState(false);
  const tooltipOpen = (hovered || focused) && !escapeDismissed;
  useEffect(() => {
    if (!tooltipOpen) return;
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setEscapeDismissed(true);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [tooltipOpen]);
  const dismissOnEscape = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape" || !tooltipOpen) return;
    event.stopPropagation();
    setEscapeDismissed(true);
  };

  return (
    <button
      {...props}
      aria-describedby={tooltipOpen ? tooltipId : undefined}
      aria-label={label}
      onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
      onFocus={(event) => { setFocused(true); setEscapeDismissed(false); props.onFocus?.(event); }}
      onKeyDown={(event) => { dismissOnEscape(event); props.onKeyDown?.(event); }}
      onPointerEnter={(event) => { setHovered(true); setEscapeDismissed(false); props.onPointerEnter?.(event); }}
      onPointerLeave={(event) => { setHovered(false); props.onPointerLeave?.(event); }}
      type="button"
    >
      {children}
      {tooltipOpen && <span className="canvas-toolbar__tooltip" id={tooltipId} role="tooltip">{label}</span>}
    </button>
  );
}

export function CanvasToolbar({ mode, canUndo, canRedo, onMode, onAddThought, onAddMedia, onUndo, onRedo }: CanvasToolbarProps) {
  return (
    <div aria-label="Canvas tools" className="canvas-toolbar" role="toolbar">
      {MODES.map(({ mode: item, label, shortcut, icon: Icon }) => (
        <ToolButton aria-keyshortcuts={shortcut} aria-pressed={mode === item} key={item} label={label} onClick={() => onMode(item)}>
          <Icon aria-hidden="true" />
        </ToolButton>
      ))}
      <span aria-hidden="true" className="canvas-toolbar__divider" />
      <ToolButton label="Add thought" onClick={onAddThought}><Plus aria-hidden="true" /></ToolButton>
      <ToolButton label="Add media" onClick={onAddMedia}><ImagePlus aria-hidden="true" /></ToolButton>
      <span aria-hidden="true" className="canvas-toolbar__divider" />
      <ToolButton disabled={!canUndo} label="Undo" onClick={onUndo}><Undo2 aria-hidden="true" /></ToolButton>
      <ToolButton disabled={!canRedo} label="Redo" onClick={onRedo}><Redo2 aria-hidden="true" /></ToolButton>
    </div>
  );
}
