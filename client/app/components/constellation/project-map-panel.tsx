"use client";

import { useState } from "react";
import type { GraphEdge, GraphNode, NodeType } from "../../lib/project-types";

const TYPES: NodeType[] = ["evidence", "assumption", "idea", "decision", "challenge", "output"];
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const groupLabel = (types: readonly NodeType[]) => types.map(label).join(" / ");

export function ProjectMapPanel({ activeTypes, branches, clusters, edges = [], nodes = [], unresolvedOnly, onPromote, onType, onUnresolved, onFitSelection }: {
  activeTypes: ReadonlySet<NodeType>; branches: readonly string[]; clusters: readonly string[]; unresolvedOnly: boolean;
  edges?: readonly GraphEdge[]; nodes?: readonly GraphNode[]; onPromote?: (branch: string) => void; onType: (type: NodeType, enabled: boolean) => void; onUnresolved: (enabled: boolean) => void; onFitSelection: () => void;
}) {
  const [compared, setCompared] = useState<string[]>([]);
  const toggleCompare = (branch: string) => setCompared((current) => current.includes(branch) ? current.filter((item) => item !== branch) : [...current.slice(-1), branch]);
  const branchNodes = (branch: string) => nodes.filter((node) => node.state !== "trash" && node.tags.includes(`branch:${branch}`));
  const names = new Map(nodes.map((node) => [node.id, node.title]));
  return <aside className="project-map" aria-label="Project map">
    <div><p className="project-map__eyebrow">Project map</p><h2>Constellation</h2></div>
    <fieldset aria-label="Node types"><legend>Node types</legend>{TYPES.map((type) => <label key={type}><input checked={activeTypes.has(type)} onChange={(event) => onType(type, event.target.checked)} type="checkbox" />{label(type)}</label>)}</fieldset>
    <label className="project-map__toggle"><input checked={unresolvedOnly} onChange={(event) => onUnresolved(event.target.checked)} type="checkbox" />Unresolved only</label>
    <section><h3>Clusters</h3>{clusters.length ? <ul>{clusters.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Unclustered work</p>}</section>
    <section><h3>Branches</h3>{branches.length ? <ul>{branches.map((item) => <li key={item}><label><input aria-label={`Compare ${item}`} checked={compared.includes(item)} onChange={() => toggleCompare(item)} type="checkbox" />{label(item)}</label><button disabled={!onPromote} onClick={() => onPromote?.(item)} type="button">Promote {item} decisions</button></li>)}</ul> : <p>Main branch</p>}
      {compared.length === 2 && <section aria-label="Branch comparison" className="branch-comparison">
        {compared.map((branch) => { const scoped = branchNodes(branch); const otherTitles = new Set(branchNodes(compared.find((item) => item !== branch)!).map((node) => node.title)); return <article key={branch}>
          <h4>{label(branch)}: {scoped.length} {scoped.length === 1 ? "node" : "nodes"}</h4>
          {([["idea", "decision"], ["evidence", "assumption"], ["challenge"]] as NodeType[][]).map((types) => { const members = scoped.filter((node) => types.includes(node.node_type)); return members.length ? <div key={types.join()}><h5>{groupLabel(types)}</h5><ul>{members.map((node) => <li key={node.id}>{node.title}{types.some((type) => type === "idea" || type === "decision") ? ` — ${label(node.state)}` : ""}</li>)}</ul></div> : null; })}
          <div><h5>Relationships</h5><ul>{edges.filter((edge) => scoped.some((node) => node.id === edge.source_node_id || node.id === edge.target_node_id)).map((edge) => <li key={edge.id}>{names.get(edge.source_node_id)} {edge.edge_type.replaceAll("_", " ")} {names.get(edge.target_node_id)}</li>)}</ul></div>
          <p><strong>Only {label(branch)}:</strong> {scoped.filter((node) => !otherTitles.has(node.title)).map((node) => node.title).join(", ") || "No title-level differences"}</p>
        </article>; })}
      </section>}
    </section>
    <button onClick={onFitSelection} type="button">Fit selection</button>
  </aside>;
}
