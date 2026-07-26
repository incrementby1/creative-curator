"use client";
import { useState } from "react";
import type { GraphNode } from "../../lib/project-types";
export function TrashedNodesPanel({ nodes, onRestore }: { nodes: readonly GraphNode[]; onRestore: (node: GraphNode) => Promise<void> }) {
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  return <section aria-label="Trash" className="constellation-panel"><header><p>Recoverable history</p><h2>Trash</h2></header>{nodes.length ? <ul>{nodes.map((node) => <li key={node.id}><span><strong>{node.title}</strong> · {node.node_type}</span><button disabled={busy === node.id} type="button" onClick={async () => { setBusy(node.id); setError(""); try { await onRestore(node); } catch { setError("Restore failed. Item remains in trash."); } finally { setBusy(""); } }}>{busy === node.id ? "Restoring…" : `Restore ${node.title}`}</button></li>)}</ul> : <p>Trash is empty.</p>}{error && <p role="alert">{error}</p>}</section>;
}
