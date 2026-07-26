"use client";

import { Palette } from "lucide-react";
import { useState } from "react";
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
  return <div className="theme-selector">
    <button aria-expanded={open} aria-haspopup="dialog" disabled={busy} onClick={() => setOpen((value) => !value)} type="button"><Palette aria-hidden="true" />Theme</button>
    {open && <div aria-label="Theme preferences" className="theme-selector__menu" role="dialog">
      <p className="theme-selector__effective">Effective theme: {title(effectiveTheme)}</p>
      <label>Project appearance<select value={projectTheme ?? "inherit"} disabled={busy} onChange={(event) => onProjectTheme(event.target.value === "inherit" ? null : event.target.value as ThemeChoice)}>
        <option value="inherit">Use global default</option>{choices.map((choice) => <option key={choice} value={choice}>{title(choice)}</option>)}
      </select></label>
      <label>Global default<select value={globalTheme} disabled={busy} onChange={(event) => onGlobalTheme(event.target.value as ThemeChoice)}>
        {choices.map((choice) => <option key={choice} value={choice}>{title(choice)}</option>)}
      </select></label>
      <p>Project accents use approved palette values for presentation only.</p>
    </div>}
  </div>;
}
