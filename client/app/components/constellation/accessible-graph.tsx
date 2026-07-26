"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EdgeType, GraphEdge, GraphNode } from "../../lib/project-types";

const edgeLabel = (type: EdgeType) => type.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const nodeLabel = (value: string) => value.replace(/^./, (letter) => letter.toUpperCase());

type Props = {
  active: boolean;
  edges: readonly GraphEdge[];
  nodes: readonly GraphNode[];
  selectedNodeId: string | null;
  onConnect: (sourceId: string, targetId: string, edgeType: EdgeType) => Promise<void>;
  onCreate: () => void;
  onMove: (nodeId: string, direction: "left" | "right" | "up" | "down") => void;
  onSelect: (nodeId: string) => void;
};

export function AccessibleGraph({ active, edges, nodes, selectedNodeId, onConnect, onCreate, onMove, onSelect }: Props) {
  const [targetId, setTargetId] = useState("");
  const [edgeType, setEdgeType] = useState<EdgeType>("supports");
  const [announcement, setAnnouncement] = useState("");
  const selected = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectionRef = useRef<HTMLButtonElement>(null);
  const relationships = useMemo(() => selected ? edges.filter((edge) => edge.source_node_id === selected.id || edge.target_node_id === selected.id) : [], [edges, selected]);
  const effectiveTargetId = selected && targetId !== selected.id && nodes.some((node) => node.id === targetId) ? targetId : nodes.find((node) => node.id !== selected?.id)?.id ?? "";

  useEffect(() => {
    if (active) selectionRef.current?.focus();
  }, [active, selectedNodeId]);

  return <section aria-label="Structured graph" className="accessible-graph">
    <div className="accessible-graph__heading"><div><p>Accessible equivalent</p><h2>Graph outline</h2></div><button onClick={() => { onCreate(); setAnnouncement("Created New thought"); }} type="button">Create thought</button></div>
    <p>Nodes expose type and state in words. Relationship labels state their meaning.</p>
    <p aria-label="Graph announcements" aria-live="polite" className="sr-only" role="status">{announcement}</p>
    <ul className="accessible-graph__nodes">
      {nodes.map((node) => <li key={node.id}><article aria-current={node.id === selectedNodeId ? "true" : undefined}>
        <div><h3>{node.title}</h3><p>{node.content}</p><p>Type: {nodeLabel(node.node_type)}</p><p>State: {nodeLabel(node.state)}</p></div>
        <button aria-label={`Select ${node.title}`} onClick={() => { onSelect(node.id); setAnnouncement(`Selected ${node.title}`); }} ref={node.id === selectedNodeId ? selectionRef : undefined} type="button">{node.id === selectedNodeId ? "Selected" : "Select"}</button>
      </article></li>)}
    </ul>
    {selected && <section aria-label={`Actions for ${selected.title}`} className="accessible-graph__actions">
      <h3>Actions for {selected.title}</h3>
      <div aria-label="Move selected node" className="accessible-graph__move">{(["left", "right", "up", "down"] as const).map((direction) => <button aria-label={`Move ${selected.title} ${direction}`} key={direction} onClick={() => { onMove(selected.id, direction); setAnnouncement(`Moved ${selected.title} ${direction}`); }} type="button">{nodeLabel(direction)}</button>)}</div>
      <h4>Relationships</h4>
      {relationships.length ? <ul>{relationships.map((edge) => { const outgoing = edge.source_node_id === selected.id; const otherId = outgoing ? edge.target_node_id : edge.source_node_id; const other = nodes.find((node) => node.id === otherId); return <li key={edge.id}>{outgoing ? `${edgeLabel(edge.edge_type)} ${other?.title ?? "Unknown node"}` : `${other?.title ?? "Unknown node"} ${edgeLabel(edge.edge_type).toLowerCase()} this node`}</li>; })}</ul> : <p>No relationships yet.</p>}
      <div className="accessible-graph__connect"><label>Relationship type<select value={edgeType} onChange={(event) => setEdgeType(event.target.value as EdgeType)}>{(["supports", "contradicts", "depends_on", "inspires", "supersedes"] as EdgeType[]).map((type) => <option key={type} value={type}>{edgeLabel(type)}</option>)}</select></label>
        <label>Relationship target<select value={effectiveTargetId} onChange={(event) => setTargetId(event.target.value)}>{nodes.filter((node) => node.id !== selected.id).map((node) => <option key={node.id} value={node.id}>{nodeLabel(node.node_type)} — {node.title}</option>)}</select></label>
        <button disabled={!effectiveTargetId} onClick={() => void onConnect(selected.id, effectiveTargetId, edgeType).then(() => setAnnouncement(`${edgeLabel(edgeType)} relationship created`)).catch(() => setAnnouncement("Relationship not created. Try again."))} type="button">Create labeled relationship</button></div>
    </section>}
  </section>;
}
