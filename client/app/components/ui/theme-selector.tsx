"use client";

import { Palette } from "lucide-react";
import { useState } from "react";
import type { ThemeChoice } from "../../lib/project-types";

const choices: readonly ThemeChoice[] = ["paper", "graphite", "project"];
const title = (value: ThemeChoice) => value[0].toUpperCase() + value.slice(1);

export function ThemeSelector({ effectiveTheme, onGlobalTheme, onProjectTheme, busy = false }: {
  effectiveTheme: ThemeChoice;
  onGlobalTheme: (theme: ThemeChoice) => void;
  onProjectTheme: (theme: ThemeChoice | null) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <div className="theme-selector">
    <button aria-expanded={open} aria-haspopup="dialog" disabled={busy} onClick={() => setOpen((value) => !value)} type="button"><Palette aria-hidden="true" />Theme</button>
    {open && <div aria-label="Theme preferences" className="theme-selector__menu" role="dialog">
      <label>Project appearance<select defaultValue={effectiveTheme} disabled={busy} onChange={(event) => onProjectTheme(event.target.value === "inherit" ? null : event.target.value as ThemeChoice)}>
        <option value="inherit">Use global default</option>{choices.map((choice) => <option key={choice} value={choice}>{title(choice)}</option>)}
      </select></label>
      <label>Global default<select defaultValue={effectiveTheme} disabled={busy} onChange={(event) => onGlobalTheme(event.target.value as ThemeChoice)}>
        {choices.map((choice) => <option key={choice} value={choice}>{title(choice)}</option>)}
      </select></label>
      <p>Project accents use approved palette values for presentation only.</p>
    </div>}
  </div>;
}
