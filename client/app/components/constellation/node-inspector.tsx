"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { EdgeType, GraphNode, NodeRevision, NodeState, NodeType, NodeUpdateInput } from "../../lib/project-types";

export function NodeInspector({ node, connections, revisions, loadingRevisions, availableNodes = [], focusRequest = null, onConnect, onFocusRequestHandled, onSave }: { node: GraphNode; connections: readonly string[]; revisions: readonly NodeRevision[]; loadingRevisions: boolean; availableNodes?: readonly GraphNode[]; focusRequest?: string | null; onConnect?: (targetId: string, edgeType: EdgeType) => Promise<void>; onFocusRequestHandled?: (token: string) => void; onSave: (input: NodeUpdateInput) => Promise<void> }) {
  const [title, setTitle] = useState(node.title); const [content, setContent] = useState(node.content);
  const [nodeType, setNodeType] = useState<NodeType>(node.node_type); const [state, setState] = useState<NodeState>(node.state);
  const [provenance, setProvenance] = useState(node.provenance ?? ""); const [status, setStatus] = useState("");
  const [targetId, setTargetId] = useState(""); const [edgeType, setEdgeType] = useState<EdgeType>("supports"); const [connectionStatus, setConnectionStatus] = useState("");
  const titleRef = useRef<HTMLInputElement>(null); const handledFocusRequest = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focusRequest || handledFocusRequest.current === focusRequest || !titleRef.current) return;
    handledFocusRequest.current = focusRequest;
    titleRef.current.focus();
    onFocusRequestHandled?.(focusRequest);
  }, [focusRequest, onFocusRequestHandled]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setStatus("Saving node…");
    try { await onSave({ title: title.trim(), content: content.trim(), node_type: nodeType, state, created_by: node.created_by, provenance: provenance.trim() || null, tags: node.tags, expected_node_version: node.version, expected_project_version: 0 }); setStatus("Node saved"); }
    catch { setStatus("Node save failed. Edits preserved."); }
  }
  return <section aria-label="Node inspector" className="constellation-panel node-inspector"><header><p>Inspector</p><h2>{node.title}</h2></header>
    <form onSubmit={save}><label>Node title<input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Content<textarea value={content} onChange={(e) => setContent(e.target.value)} /></label>
      <div className="field-pair"><label>Node type<select value={nodeType} onChange={(e) => setNodeType(e.target.value as NodeType)}>{["evidence","assumption","idea","decision","challenge","output"].map((v) => <option key={v}>{v}</option>)}</select></label><label>State<select value={state} onChange={(e) => setState(e.target.value as NodeState)}>{["working","approved","trash"].map((v) => <option key={v}>{v}</option>)}</select></label></div>
      <label>Source<input readOnly value={node.created_by} /></label><label>Provenance<textarea value={provenance} onChange={(e) => setProvenance(e.target.value)} /></label><button type="submit">Save node</button><p aria-live="polite">{status}</p></form>
    <section><h3>Connections</h3>{connections.length ? <ul>{connections.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No semantic connections.</p>}
      {onConnect && <div className="inspector-connection"><label>Connection target<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose node</option>{availableNodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Relationship type<select value={edgeType} onChange={(event) => setEdgeType(event.target.value as EdgeType)}>{["supports","contradicts","depends_on","inspires","supersedes"].map((item) => <option key={item}>{item}</option>)}</select></label><button disabled={!targetId} onClick={async () => { setConnectionStatus("Saving relationship…"); try { await onConnect(targetId, edgeType); setConnectionStatus("Relationship saved"); setTargetId(""); } catch { setConnectionStatus("Relationship failed. Selection preserved."); } }} type="button">Add relationship</button><p aria-live="polite">{connectionStatus}</p></div>}
    </section>
    <section id="history"><h3>Revision history</h3>{loadingRevisions ? <p>Loading history…</p> : revisions.length ? <ol>{revisions.map((revision) => <li key={revision.id}><strong>{revision.title}</strong><span>Version {revision.node_version}</span></li>)}</ol> : <p>No earlier revisions.</p>}</section>
  </section>;
}
