"use client";

import { Palette } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThemeChoice } from "../../lib/project-types";

const choices: readonly ThemeChoice[] = ["paper", "graphite", "project"];
const title = (value: ThemeChoice) => value[0].toUpperCase() + value.slice(1);

export function ThemeSelector({ effectiveTheme, globalTheme, projectTheme, onGlobalTheme, onProjectTheme, busy = false }: {
  effectiveTheme: ThemeChoice;
  globalTheme: ThemeChoice;
  projectTheme: ThemeChoice | null;
  onGlobalTheme: (theme: ThemeChoice) => void;
  onProjectTheme: (theme: ThemeChoice | null) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null); const triggerRef = useRef<HTMLButtonElement>(null); const firstControlRef = useRef<HTMLSelectElement>(null);
  const close = useCallback((restoreFocus = true) => { setOpen(false); if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus()); }, []);
  useEffect(() => {
    if (!open) return;
    firstControlRef.current?.focus();
    const outside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("mousedown", outside); return () => document.removeEventListener("mousedown", outside);
  }, [close, open]);
  return <div className="theme-selector" ref={rootRef}>
    <button aria-controls="theme-preferences" aria-expanded={open} disabled={busy} onClick={() => open ? close() : setOpen(true)} ref={triggerRef} type="button"><Palette aria-hidden="true" />Theme</button>
    {open && <div aria-label="Theme preferences" className="theme-selector__menu" id="theme-preferences" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }} role="region">
      <p className="theme-selector__effective">Effective theme: {title(effectiveTheme)}</p>
      <label>Project appearance<select value={projectTheme ?? "inherit"} disabled={busy} onChange={(event) => onProjectTheme(event.target.value === "inherit" ? null : event.target.value as ThemeChoice)} ref={firstControlRef}>
        <option value="inherit">Use global default</option>{choices.map((choice) => <option key={choice} value={choice}>{title(choice)}</option>)}
      </select></label>
      <label>Global default<select value={globalTheme} disabled={busy} onChange={(event) => onGlobalTheme(event.target.value as ThemeChoice)}>
        {choices.map((choice) => <option key={choice} value={choice}>{title(choice)}</option>)}
      </select></label>
      <p>Project accents use approved palette values for presentation only.</p>
      <button className="theme-selector__close" onClick={() => close()} type="button">Close theme preferences</button>
    </div>}
  </div>;
}
