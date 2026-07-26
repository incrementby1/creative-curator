"use client";

import { useState } from "react";
import type { ChallengeResolution, ChallengeState, GraphNode } from "../../lib/project-types";

const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function ChallengePanel({ challenge, dependencies, historyHref, resolutions = [], onResolve }: { challenge: GraphNode; dependencies: readonly string[]; historyHref: string; resolutions?: readonly ChallengeResolution[]; onResolve: (state: Extract<ChallengeState, "resolved" | "deferred" | "overridden">, note: string) => Promise<void> }) {
  const [note, setNote] = useState(""); const [error, setError] = useState(""); const [announcement, setAnnouncement] = useState(""); const [busy, setBusy] = useState(false);
  async function decide(state: "resolved" | "deferred" | "overridden") {
    if (state === "overridden" && !note.trim()) { setError("Override note is required."); return; }
    setError(""); setBusy(true);
    try { await onResolve(state, note.trim()); setAnnouncement(`Challenge ${state}`); }
    catch { setError("Challenge update failed. Note preserved."); } finally { setBusy(false); }
  }
  const resolution = resolutions[0]; const confidence = challenge.challenge_confidence; const downstream = challenge.challenge_downstream_effect ?? "No downstream effect recorded";
  return <section aria-label={resolution ? "Resolved challenge" : "Active challenge"} className="constellation-panel challenge-panel"><header><p>{resolution ? "Challenge history" : "Active challenge"}</p><h2>{challenge.title}</h2></header><h3>Rationale</h3><p>{challenge.content}</p><h3>Dependencies</h3>{dependencies.length ? <ul>{dependencies.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None linked.</p>}
    <dl><div><dt>Confidence</dt><dd>{confidence === null || confidence === undefined ? "Not stated" : `${confidence}%`}</dd></div><div><dt>Likely downstream effect</dt><dd>{downstream}</dd></div></dl>
    {resolution ? <a href={historyHref}>View resolution history</a> : <><label>Resolution note<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="panel-actions"><button disabled={busy} onClick={() => void decide("resolved")} type="button">Resolve</button><button disabled={busy} onClick={() => void decide("deferred")} type="button">Defer</button><button disabled={busy} onClick={() => void decide("overridden")} type="button">Override</button></div></>}
    {announcement && <p role="status">{announcement}.</p>}
    <section aria-labelledby={`${challenge.id}-resolution-history-title`} id={historyHref.slice(1)} tabIndex={-1}><h3 id={`${challenge.id}-resolution-history-title`}>Resolution history</h3>{resolutions.length ? <ol>{resolutions.map((item) => <li key={item.id} data-resolution-id={item.id}><strong>{label(item.state)}</strong><p>{item.resolution}</p><p>Resolved by {item.resolved_by ?? "unknown"} · <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></p></li>)}</ol> : <p>No resolution recorded.</p>}</section>
  </section>;
}
