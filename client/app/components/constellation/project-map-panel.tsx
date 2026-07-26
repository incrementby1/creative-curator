"use client";

import { useState } from "react";
import type { GraphNode, NodeType } from "../../lib/project-types";

const TYPES: NodeType[] = ["evidence", "assumption", "idea", "decision", "challenge", "output"];
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function ProjectMapPanel({ activeTypes, branches, clusters, nodes = [], unresolvedOnly, onPromote, onType, onUnresolved, onFitSelection }: {
  activeTypes: ReadonlySet<NodeType>; branches: readonly string[]; clusters: readonly string[]; unresolvedOnly: boolean;
  nodes?: readonly GraphNode[]; onPromote?: (branch: string) => void; onType: (type: NodeType, enabled: boolean) => void; onUnresolved: (enabled: boolean) => void; onFitSelection: () => void;
}) {
  const [compared, setCompared] = useState<string[]>([]);
  const toggleCompare = (branch: string) => setCompared((current) => current.includes(branch) ? current.filter((item) => item !== branch) : [...current.slice(-1), branch]);
  const branchCount = (branch: string) => nodes.filter((node: GraphNode) => node.tags.includes(`branch:${branch}`)).length;
  return <aside className="project-map" aria-label="Project map">
    <div><p className="project-map__eyebrow">Project map</p><h2>Constellation</h2></div>
    <fieldset aria-label="Node types"><legend>Node types</legend>{TYPES.map((type) => <label key={type}>
      <input checked={activeTypes.has(type)} onChange={(event) => onType(type, event.target.checked)} type="checkbox" />{label(type)}
    </label>)}</fieldset>
    <label className="project-map__toggle"><input checked={unresolvedOnly} onChange={(event) => onUnresolved(event.target.checked)} type="checkbox" />Unresolved only</label>
    <section><h3>Clusters</h3>{clusters.length ? <ul>{clusters.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Unclustered work</p>}</section>
    <section><h3>Branches</h3>{branches.length ? <ul>{branches.map((item) => <li key={item}><label><input aria-label={`Compare ${item}`} checked={compared.includes(item)} onChange={() => toggleCompare(item)} type="checkbox" />{label(item)}</label><button disabled={!onPromote} onClick={() => onPromote?.(item)} type="button">Promote {item} decisions</button></li>)}</ul> : <p>Main branch</p>}{compared.length === 2 && <div aria-label="Branch comparison">{compared.map((item) => <p key={item}>{label(item)}: {branchCount(item)} {branchCount(item) === 1 ? "node" : "nodes"}</p>)}</div>}</section>
    <button onClick={onFitSelection} type="button">Fit selection</button>
  </aside>;
}
