"use client";

import { useState } from "react";
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

export function HeldRecoveryPanel({ edits, onApply, onDiscard }: {
  edits: readonly PendingProjectEdit[]; onApply: (edit: PendingProjectEdit) => Promise<void>; onDiscard: (edit: PendingProjectEdit) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<{ action: "apply" | "discard"; edit: PendingProjectEdit } | null>(null); const [status, setStatus] = useState("");
  const run = async () => {
    if (!confirm) return; setStatus(confirm.action === "apply" ? "Saving recovered edit…" : "Discarding in-tab recovery…");
    try { await (confirm.action === "apply" ? onApply(confirm.edit) : onDiscard(confirm.edit)); setStatus(confirm.action === "apply" ? "Recovered edit saved." : "In-tab recovery discarded."); setConfirm(null); }
    catch { setStatus(confirm.action === "apply" ? "Recovered edit was not saved. Review remains available." : "In-tab recovery could not be discarded."); }
  };
  return <section aria-label="Held recovery" className="constellation-panel held-recovery" role="region">
    <header><p>Held in this tab</p><h2>Recovery awaiting your decision</h2></header>
    <p>Nothing here retries automatically. Apply against latest project state or discard it.</p>
    {edits.map((edit) => <article key={edit.idempotencyKey}><h3>{labels[edit.operation]}</h3><pre aria-label="Held submitted semantic values">{submitted(edit)}</pre>
      <div className="panel-actions"><button disabled={edit.operation !== "update_node"} onClick={() => { setStatus(""); setConfirm({ action: "apply", edit }); }} type="button">Apply recovered edit</button><button onClick={() => { setStatus(""); setConfirm({ action: "discard", edit }); }} type="button">Discard in-tab recovery</button></div>
    </article>)}
    {confirm && <div aria-label={`Confirm ${confirm.action}`} role="group"><p>{confirm.action === "apply" ? "Save these submitted values against latest node and project versions?" : "Discard this in-tab recovery permanently?"}</p><button autoFocus onClick={() => void run()} type="button">Confirm {confirm.action}</button><button onClick={() => setConfirm(null)} type="button">Cancel</button></div>}
    <p aria-live="polite">{status}</p>
  </section>;
}
