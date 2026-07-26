"use client";

import type { NodeType } from "../../lib/project-types";

const TYPES: NodeType[] = ["evidence", "assumption", "idea", "decision", "challenge", "output"];
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function ProjectMapPanel({ activeTypes, branches, clusters, unresolvedOnly, onType, onUnresolved, onFitSelection }: {
  activeTypes: ReadonlySet<NodeType>; branches: readonly string[]; clusters: readonly string[]; unresolvedOnly: boolean;
  onType: (type: NodeType, enabled: boolean) => void; onUnresolved: (enabled: boolean) => void; onFitSelection: () => void;
}) {
  return <aside className="project-map" aria-label="Project map">
    <div><p className="project-map__eyebrow">Project map</p><h2>Constellation</h2></div>
    <fieldset aria-label="Node types"><legend>Node types</legend>{TYPES.map((type) => <label key={type}>
      <input checked={activeTypes.has(type)} onChange={(event) => onType(type, event.target.checked)} type="checkbox" />{label(type)}
    </label>)}</fieldset>
    <label className="project-map__toggle"><input checked={unresolvedOnly} onChange={(event) => onUnresolved(event.target.checked)} type="checkbox" />Unresolved only</label>
    <section><h3>Clusters</h3>{clusters.length ? <ul>{clusters.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Unclustered work</p>}</section>
    <section><h3>Branches</h3>{branches.length ? <ul>{branches.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Main branch</p>}</section>
    <button onClick={onFitSelection} type="button">Fit selection</button>
  </aside>;
}
