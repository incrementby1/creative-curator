"use client";
import { useRef, useState } from "react";

type Values = Readonly<Record<string, unknown>>;
export function ConflictPanel({ submitted, latest, submittedVersion, latestVersion, onKeepMine, onAcceptLatest, onClose }: {
  submitted: Values; latest: Values; submittedVersion: number; latestVersion: number;
  onKeepMine: () => void | Promise<void>; onAcceptLatest: () => void; onClose?: () => void;
}) {
  const [confirming, setConfirming] = useState(false); const [retrying, setRetrying] = useState(false); const [retryError, setRetryError] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null); const comparisonRef = useRef<HTMLDivElement>(null);
  const compare = (value: Values) => Object.entries(value).map(([key, entry]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{typeof entry === "string" ? entry : JSON.stringify(entry)}</dd></div>);
  return <section aria-label="Version conflict" className="constellation-panel conflict-panel" role="alertdialog" aria-modal="false">
    <header><p>Save paused</p><h2>Version conflict</h2></header><p>Nothing changed yet. Compare both versions, then choose.</p>
    <div className="conflict-panel__comparison" ref={comparisonRef} tabIndex={-1}><section><h3>Submitted</h3><strong>Version {submittedVersion}</strong><dl>{compare(submitted)}</dl></section><section><h3>Latest</h3><strong>Version {latestVersion}</strong><dl>{compare(latest)}</dl></section></div>
    <div className="panel-actions"><button type="button" onClick={() => comparisonRef.current?.focus()}>Compare versions</button><button type="button" onClick={() => { setConfirming(true); queueMicrotask(() => confirmRef.current?.focus()); }}>Keep mine</button><button type="button" onClick={onAcceptLatest}>Accept latest</button>{onClose && <button type="button" onClick={onClose}>Decide later</button>}</div>
    {confirming && <div aria-label="Confirm keep mine" role="dialog"><p>Retry submitted values against latest version {latestVersion}?</p>
      {retryError && <p role="alert">Retry failed. Submitted recovery remains queued; try again.</p>}
      <button disabled={retrying} ref={confirmRef} type="button" onClick={() => { setRetrying(true); setRetryError(""); void Promise.resolve(onKeepMine()).catch(() => setRetryError("failed")).finally(() => setRetrying(false)); }}>{retrying ? "Retrying…" : "Confirm keep mine"}</button><button disabled={retrying} type="button" onClick={() => { setConfirming(false); setRetryError(""); }}>Cancel</button></div>}
  </section>;
}
