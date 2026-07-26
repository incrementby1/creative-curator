"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "../../lib/project-types";

const words = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function MobileGraphNavigator({ edges, nodes, selectedNodeId, onSelect }: { edges: readonly GraphEdge[]; nodes: readonly GraphNode[]; selectedNodeId: string | null; onSelect: (id: string) => void }) {
  const [activation, setActivation] = useState({ id: "", sequence: 0, text: "" });
  const focusRef = useRef<HTMLHeadingElement>(null);
  const selectedIndex = Math.max(0, nodes.findIndex((node) => node.id === selectedNodeId));
  const selected = nodes[selectedIndex] ?? null;
  const relations = useMemo(() => selected ? edges.filter((edge) => edge.source_node_id === selected.id || edge.target_node_id === selected.id).map((edge) => {
    const otherId = edge.source_node_id === selected.id ? edge.target_node_id : edge.source_node_id;
    return { edge, outgoing: edge.source_node_id === selected.id, other: nodes.find((node) => node.id === otherId) };
  }) : [], [edges, nodes, selected]);
  const focusNode = (nodeId: string) => {
    const index = nodes.findIndex((node) => node.id === nodeId); const node = nodes[index]; if (!node) return;
    const neighbors = edges.filter((edge) => edge.source_node_id === nodeId || edge.target_node_id === nodeId).length;
    const text = `Focused ${node.title}. Type ${words(node.node_type)}. Node ${index + 1} of ${nodes.length}. ${neighbors} neighboring ${neighbors === 1 ? "relationship" : "relationships"}.`;
    setActivation((current) => ({ id: nodeId, sequence: current.sequence + 1, text })); onSelect(nodeId);
  };
  const move = (amount: number) => { if (nodes.length) focusNode(nodes[(selectedIndex + amount + nodes.length) % nodes.length].id); };
  useEffect(() => {
    if (activation.id === selectedNodeId && activation.sequence > 0) focusRef.current?.focus();
  }, [activation.id, activation.sequence, selectedNodeId]);

  return <section aria-label="Mobile graph navigator" className="mobile-graph-navigator">
    <header><div><p>Focus mode</p><h2>Constellation overview</h2></div><span>Automatic layout active</span></header>
    <p aria-label="Mobile graph announcements" aria-live="polite" className="sr-only" role="status">{activation.text && <span key={activation.sequence}>{activation.text}</span>}</p>
    <nav aria-label="Constellation nodes"><ul>{nodes.map((node) => <li key={node.id}><button aria-current={node.id === selected?.id ? "true" : undefined} aria-label={`Focus ${node.title}`} onClick={() => focusNode(node.id)} type="button"><span>{node.title}</span><small>{words(node.node_type)} · {words(node.state)}</small></button></li>)}</ul></nav>
    {selected && <article className="mobile-graph-navigator__focus"><p>Focused node</p><h3 ref={focusRef} tabIndex={-1}>{selected.title}</h3><p>{selected.content}</p><p>Type: {words(selected.node_type)}</p><p>State: {words(selected.state)}</p>
      <div className="mobile-graph-navigator__traverse"><button onClick={() => move(-1)} type="button">Previous node</button><span>{selectedIndex + 1} of {nodes.length}</span><button onClick={() => move(1)} type="button">Next node</button></div>
      <section aria-label="Neighbor relationships"><h4>Neighbor relationships</h4>{relations.length ? <ul>{relations.map(({ edge, outgoing, other }) => <li key={edge.id}><button disabled={!other} onClick={() => other && focusNode(other.id)} type="button"><strong>{outgoing ? "Outgoing" : "Incoming"}: {words(edge.edge_type)}</strong><span>{other?.title ?? "Unknown node"}</span></button></li>)}</ul> : <p>No connected neighbors yet. Use inspector below to connect this node.</p>}</section>
    </article>}
  </section>;
}
