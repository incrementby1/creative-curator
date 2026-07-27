"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EdgeType, GraphNode, NodeRevision, NodeState, NodeType, NodeUpdateInput } from "../../lib/project-types";
import { BLUEPRINT_SECTIONS, buildNodeTags, parseNodeTags } from "../../lib/project-taxonomy";

export type NodeConnection = Readonly<{ id: string; label: string }>;

export function NodeInspector({ node, connections, revisions, loadingRevisions, width, height, availableNodes = [], focusRequest = null, onConnect, onFocusRequestHandled, onResize, onSave }: { node: GraphNode; connections: readonly NodeConnection[]; revisions: readonly NodeRevision[]; loadingRevisions: boolean; width: number; height: number; availableNodes?: readonly GraphNode[]; focusRequest?: string | null; onConnect?: (targetId: string, edgeType: EdgeType) => Promise<void>; onFocusRequestHandled?: (token: string) => void; onResize?: (width: number, height: number) => Promise<void>; onSave: (input: NodeUpdateInput) => Promise<void> }) {
  const [title, setTitle] = useState(node.title); const [content, setContent] = useState(node.content);
  const [nodeType, setNodeType] = useState<NodeType>(node.node_type); const [state, setState] = useState<NodeState>(node.state);
  const [provenance, setProvenance] = useState(node.provenance ?? ""); const [status, setStatus] = useState("");
  const initialTaxonomy = parseNodeTags(node.tags);
  const [section, setSection] = useState(initialTaxonomy.section); const [branch, setBranch] = useState(initialTaxonomy.branch);
  const [cluster, setCluster] = useState(initialTaxonomy.cluster); const [palette, setPalette] = useState(initialTaxonomy.palette);
  const [targetId, setTargetId] = useState(""); const [edgeType, setEdgeType] = useState<EdgeType>("supports"); const [connectionStatus, setConnectionStatus] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false); const connectionBusyRef = useRef(false);
  const [nodeWidth, setNodeWidth] = useState(String(Math.round(width))); const [nodeHeight, setNodeHeight] = useState(String(Math.round(height))); const [sizeStatus, setSizeStatus] = useState("");
  const [sizeBusy, setSizeBusy] = useState(false); const sizeBusyRef = useRef(false);
  const [sizeDirty, setSizeDirty] = useState(false); const previousGeometry = useRef({ width, height }); const sizeEditRevision = useRef(0);
  const parsedWidth = Number(nodeWidth); const parsedHeight = Number(nodeHeight);
  const validSize = Number.isFinite(parsedWidth) && parsedWidth >= 208 && parsedWidth <= 1200 && Number.isFinite(parsedHeight) && parsedHeight >= 112 && parsedHeight <= 900;
  const titleRef = useRef<HTMLInputElement>(null); const handledFocusRequest = useRef<string | null>(null);
  useEffect(() => {
    const changed = previousGeometry.current.width !== width || previousGeometry.current.height !== height;
    previousGeometry.current = { width, height };
    if (!changed || sizeDirty) return;
    setNodeWidth(String(Math.round(width))); setNodeHeight(String(Math.round(height)));
  }, [height, sizeDirty, width]);
  useLayoutEffect(() => {
    if (!focusRequest || handledFocusRequest.current === focusRequest || !titleRef.current) return;
    handledFocusRequest.current = focusRequest;
    titleRef.current.focus();
    onFocusRequestHandled?.(focusRequest);
  }, [focusRequest, onFocusRequestHandled]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setStatus("Saving node…");
    try { const tags = buildNodeTags({ section, branch, cluster, palette }, node.tags); await onSave({ title: title.trim(), content: content.trim(), node_type: nodeType, state, created_by: node.created_by, provenance: provenance.trim() || null, tags, expected_node_version: node.version, expected_project_version: 0 }); setStatus("Node saved"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Node save failed. Edits preserved."); }
  }
  return <section aria-label="Node inspector" className="constellation-panel node-inspector"><header><p>Inspector</p><h2>{node.title}</h2></header>
    <form onSubmit={save}><label>Node title<input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Content<textarea value={content} onChange={(e) => setContent(e.target.value)} /></label>
      <div className="field-pair"><label>Node type<select value={nodeType} onChange={(e) => setNodeType(e.target.value as NodeType)}>{["evidence","assumption","idea","decision","challenge","output"].map((v) => <option key={v}>{v}</option>)}</select></label><label>State<select value={state} onChange={(e) => setState(e.target.value as NodeState)}>{["working","approved","review_suggested","trash"].map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select></label></div>
      <label>Blueprint section<select value={section} onChange={(event) => setSection(event.target.value as typeof section)}><option value="">Not assigned</option>{BLUEPRINT_SECTIONS.map((item) => <option key={item} value={item}>{item.replaceAll("-", " ")}</option>)}</select></label>
      <div className="field-pair"><label>Branch<input maxLength={64} value={branch} onChange={(event) => setBranch(event.target.value)} /></label><label>Cluster<input maxLength={64} value={cluster} onChange={(event) => setCluster(event.target.value)} /></label></div>
      {nodeType === "decision" && section === "visual-direction" && <label>Accessible palette<input aria-describedby="palette-help" placeholder="#1F4D3A,#F5EBDD" value={palette} onChange={(event) => setPalette(event.target.value)} /><small id="palette-help">Comma-separated 6-digit hex colors; palette must include a 3:1 contrast pair.</small></label>}
      <label>Source<input readOnly value={node.created_by} /></label><label>Provenance<textarea value={provenance} onChange={(e) => setProvenance(e.target.value)} /></label><button type="submit">Save node</button><p aria-live="polite">{status}</p></form>
    <section><h3>Connect nodes</h3>{connections.length ? <ul>{connections.map((item) => <li key={item.id}>{item.label}</li>)}</ul> : <p>No semantic connections.</p>}
      {onConnect && <div className="inspector-connection"><label>Connection target<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose node</option>{availableNodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Relationship type<select value={edgeType} onChange={(event) => setEdgeType(event.target.value as EdgeType)}>{["supports","contradicts","depends_on","inspires","supersedes"].map((item) => <option key={item}>{item}</option>)}</select></label><button disabled={!targetId || connectionBusy} onClick={async () => { if (connectionBusyRef.current) return; connectionBusyRef.current = true; setConnectionBusy(true); setConnectionStatus("Saving relationship…"); try { await onConnect(targetId, edgeType); setConnectionStatus("Relationship saved"); setTargetId(""); } catch { setConnectionStatus("Relationship failed. Selection preserved."); } finally { connectionBusyRef.current = false; setConnectionBusy(false); } }} type="button">Add relationship</button><p aria-live="polite">{connectionStatus}</p></div>}
    </section>
    <section><h3>Size &amp; position</h3><p>Set precise node dimensions. Use arrow keys on the selected canvas node to adjust position.</p>
      <div className="field-pair"><label>Node width<input max={1200} min={208} onChange={(event) => { sizeEditRevision.current += 1; setNodeWidth(event.target.value); setSizeDirty(true); setSizeStatus(""); }} type="number" value={nodeWidth} /></label><label>Node height<input max={900} min={112} onChange={(event) => { sizeEditRevision.current += 1; setNodeHeight(event.target.value); setSizeDirty(true); setSizeStatus(""); }} type="number" value={nodeHeight} /></label></div>
      <button disabled={!onResize || !validSize || sizeBusy} onClick={async () => { if (!onResize || sizeBusyRef.current) return; sizeBusyRef.current = true; setSizeBusy(true); const submittedRevision = sizeEditRevision.current; const submittedWidth = parsedWidth; const submittedHeight = parsedHeight; setSizeStatus("Saving node size…"); try { await onResize(submittedWidth, submittedHeight); if (sizeEditRevision.current === submittedRevision) { setSizeDirty(false); setSizeStatus("Node size saved."); } else setSizeStatus("Earlier node size saved. New values are not saved."); } catch { setSizeStatus("Node size was not saved. Values preserved."); } finally { sizeBusyRef.current = false; setSizeBusy(false); } }} type="button">Apply node size</button>
      <p aria-label="Node size status" aria-live="polite">{sizeStatus}</p>
    </section>
    <section id="history"><h3>Revision history</h3>{loadingRevisions ? <p>Loading history…</p> : revisions.length ? <ol>{revisions.map((revision) => <li key={revision.id}><strong>{revision.title}</strong><span>Version {revision.node_version}</span></li>)}</ol> : <p>No earlier revisions.</p>}</section>
  </section>;
}
