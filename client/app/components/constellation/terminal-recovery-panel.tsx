"use client";

import { useRef, useState } from "react";
import type { PendingProjectEdit } from "../../lib/pending-project-edits";

const labels: Record<PendingProjectEdit["operation"], string> = {
  create_node: "Create node", update_node: "Update node", create_edge: "Create relationship",
  delete_edge: "Delete relationship", trash_node: "Move node to trash", restore_node: "Restore node",
  accept_proposal: "Accept proposal", reject_proposal: "Reject proposal", resolve_challenge: "Resolve challenge",
};
function submitted(edit: PendingProjectEdit): string {
  const safe = JSON.stringify(edit.payload, (key, value) => /api.?key|provider|prompt|raw|secret|token|credential|ciphertext/i.test(key) ? undefined : value);
  return safe.length > 2_000 ? `${safe.slice(0, 2_000)}…` : safe;
}

export function TerminalRecoveryPanel({ edit, category, onDiscard, onKeepInTab }: {
  edit: PendingProjectEdit; category: string; onDiscard: () => Promise<void>; onKeepInTab: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<"discard" | "keep" | null>(null); const [status, setStatus] = useState(""); const confirmRef = useRef<HTMLButtonElement>(null);
  const request = (value: "discard" | "keep") => { setConfirm(value); queueMicrotask(() => confirmRef.current?.focus()); };
  const run = async () => { if (!confirm) return; setStatus("Updating local recovery…"); try { await (confirm === "discard" ? onDiscard() : onKeepInTab()); } catch { setStatus("Local recovery could not be changed. Allow browser storage and try again."); } };
  return <section aria-label="Local recovery needs review" className="constellation-panel" role="alertdialog">
    <header><p>Recovery review</p><h2>{labels[edit.operation]}</h2></header>
    <p>This stored operation is no longer eligible for automatic retry.</p><p>Failure category: {category}</p>
    <pre aria-label="Submitted semantic values">{submitted(edit)}</pre>
    {!confirm ? <div className="panel-actions"><button onClick={() => request("discard")} type="button">Discard local recovery</button><button onClick={() => request("keep")} type="button">Keep in tab</button></div>
      : <div role="group" aria-label={`Confirm ${confirm === "discard" ? "discard" : "keep in tab"}`}><p>{confirm === "discard" ? "Discard this local recovery permanently?" : "Remove durable recovery and keep this work only in the current tab?"}</p><button onClick={() => void run()} ref={confirmRef} type="button">Confirm</button><button onClick={() => setConfirm(null)} type="button">Cancel</button></div>}
    <p aria-live="polite">{status}</p>
  </section>;
}
