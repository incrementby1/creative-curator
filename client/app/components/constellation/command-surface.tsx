"use client";

import { useState } from "react";
import type { NodeType } from "../../lib/project-types";

export type CaptureDraft = Readonly<{ node_type: NodeType; title: string; content: string }>;

export function CommandSurface({ busy, onCapture }: { busy: boolean; onCapture: (draft: CaptureDraft) => Promise<void> }) {
  const [nodeType, setNodeType] = useState<NodeType>("idea");
  const [title, setTitle] = useState(""); const [content, setContent] = useState(""); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!title.trim()) { setError("Add a title before capture."); return; }
    setError("");
    try { await onCapture({ node_type: nodeType, title: title.trim(), content: content.trim() }); setTitle(""); setContent(""); }
    catch { setError("Capture failed. Draft preserved for retry."); }
  }
  return <form className="constellation-command" onSubmit={submit}>
    <div><label htmlFor="capture-type">Type</label><select id="capture-type" value={nodeType} onChange={(event) => setNodeType(event.target.value as NodeType)}>
      <option value="idea">Thought</option><option value="evidence">Evidence</option><option value="assumption">Assumption</option><option value="challenge">Concern</option><option value="decision">Decision</option>
    </select></div>
    <div><label htmlFor="capture-title">Thought title</label><input id="capture-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
    <div><label htmlFor="capture-content">Thought details</label><textarea id="capture-content" value={content} onChange={(event) => setContent(event.target.value)} /></div>
    {error && <p role="alert">{error}</p>}<button disabled={busy} type="submit">{busy ? "Capturing…" : "Capture thought"}</button>
  </form>;
}
