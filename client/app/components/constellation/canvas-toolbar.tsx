"use client";

import { Eraser, ImagePlus, Link2, MousePointer2, Pencil, Plus, Redo2, Undo2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
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
  controlRef?: RefObject<HTMLButtonElement | null>;
  disabledFocusTarget?: RefObject<HTMLButtonElement | null>;
}> & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">) {
  const { controlRef, disabledFocusTarget, ...buttonProps } = props;
  const localRef = useRef<HTMLButtonElement>(null);
  const buttonRef = controlRef ?? localRef;
  const tooltipId = `${useId()}-tooltip`;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [availability, setAvailability] = useState({ disabled: buttonProps.disabled, epoch: 0 });
  if (availability.disabled !== buttonProps.disabled) {
    setAvailability({ disabled: buttonProps.disabled, epoch: availability.epoch + 1 });
  }
  const [hoverEpoch, setHoverEpoch] = useState(-1);
  const [focusEpoch, setFocusEpoch] = useState(-1);
  const [escapeDismissed, setEscapeDismissed] = useState(false);
  const tooltipOpen = ((hovered && hoverEpoch === availability.epoch) || (focused && focusEpoch === availability.epoch)) && !escapeDismissed;
  useLayoutEffect(() => {
    if (buttonProps.disabled && focused) disabledFocusTarget?.current?.focus();
  }, [buttonProps.disabled, disabledFocusTarget, focused]);
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
      {...buttonProps}
      aria-describedby={tooltipOpen ? tooltipId : undefined}
      aria-label={label}
      onBlur={(event) => { setFocused(false); buttonProps.onBlur?.(event); }}
      onFocus={(event) => { setFocused(true); setFocusEpoch(availability.epoch); setEscapeDismissed(false); buttonProps.onFocus?.(event); }}
      onKeyDown={(event) => { dismissOnEscape(event); buttonProps.onKeyDown?.(event); }}
      onPointerEnter={(event) => { setHovered(true); setHoverEpoch(availability.epoch); setEscapeDismissed(false); buttonProps.onPointerEnter?.(event); }}
      onPointerLeave={(event) => { setHovered(false); buttonProps.onPointerLeave?.(event); }}
      ref={buttonRef}
      type="button"
    >
      {children}
      {tooltipOpen && <span className="canvas-toolbar__tooltip" id={tooltipId} role="tooltip">{label}</span>}
    </button>
  );
}

export function CanvasToolbar({ mode, canUndo, canRedo, onMode, onAddThought, onAddMedia, onUndo, onRedo }: CanvasToolbarProps) {
  const undoRef = useRef<HTMLButtonElement>(null);
  const redoRef = useRef<HTMLButtonElement>(null);
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
      <ToolButton controlRef={undoRef} disabled={!canUndo} disabledFocusTarget={redoRef} label="Undo" onClick={onUndo}><Undo2 aria-hidden="true" /></ToolButton>
      <ToolButton controlRef={redoRef} disabled={!canRedo} disabledFocusTarget={undoRef} label="Redo" onClick={onRedo}><Redo2 aria-hidden="true" /></ToolButton>
    </div>
  );
}
