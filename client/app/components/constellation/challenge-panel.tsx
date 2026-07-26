"use client";

import { useState } from "react";
import type { ChallengeState, GraphNode } from "../../lib/project-types";

const tagged = (node: GraphNode, prefix: string) => node.tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function ChallengePanel({ challenge, dependencies, historyHref, onResolve }: { challenge: GraphNode; dependencies: readonly string[]; historyHref: string; onResolve: (state: Extract<ChallengeState, "resolved" | "deferred" | "overridden">, note: string) => Promise<void> }) {
  const [note, setNote] = useState(""); const [error, setError] = useState(""); const [announcement, setAnnouncement] = useState(""); const [busy, setBusy] = useState(false);
  async function decide(state: "resolved" | "deferred" | "overridden") {
    if (state === "overridden" && !note.trim()) { setError("Override note is required."); return; }
    setError(""); setBusy(true);
    try { await onResolve(state, note.trim()); setAnnouncement(`Challenge ${state}`); }
    catch { setError("Challenge update failed. Note preserved."); } finally { setBusy(false); }
  }
  const confidence = tagged(challenge, "confidence:") ?? "not stated"; const downstream = tagged(challenge, "downstream:") ?? "No downstream effect recorded";
  return <section aria-label="Active challenge" className="constellation-panel challenge-panel"><header><p>Active challenge</p><h2>{challenge.title}</h2></header><h3>Rationale</h3><p>{challenge.content}</p><h3>Dependencies</h3>{dependencies.length ? <ul>{dependencies.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None linked.</p>}
    <dl><div><dt>Confidence</dt><dd>{label(confidence)} confidence</dd></div><div><dt>Likely downstream effect</dt><dd>{downstream}</dd></div></dl>
    <label>Resolution note<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="panel-actions"><button disabled={busy} onClick={() => void decide("resolved")} type="button">Resolve</button><button disabled={busy} onClick={() => void decide("deferred")} type="button">Defer</button><button disabled={busy} onClick={() => void decide("overridden")} type="button">Override</button></div>
    {announcement && <p role="status">{announcement}. <a href={historyHref}>View in history</a></p>}
  </section>;
}
