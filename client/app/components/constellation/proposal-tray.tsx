"use client";

import type { ListedProposal } from "../../lib/project-types";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export function ProposalTray({ proposals, accepting, onAccept, onReject }: { proposals: readonly ListedProposal[]; accepting: boolean; onAccept: (id: string) => void; onReject: (id: string) => void }) {
  const reducedMotion = useReducedMotion();
  if (!proposals.length) return null;
  return <section aria-label="Hermes proposal tray" className="constellation-panel proposal-tray"><header><p>Hermes proposals</p><h2>Review before applying</h2></header>
    <AnimatePresence initial={false}>{proposals.map((proposal) => <motion.article animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} initial={reducedMotion ? false : { opacity: 0, y: 6 }} key={proposal.id} transition={{ duration: reducedMotion ? 0 : .16 }}><div><strong>{proposal.title}</strong><span>Preview · not approved</span></div><p>{proposal.rationale}</p>
      <ul>{proposal.candidate.proposed_nodes.map((node) => <li key={node.client_key}><b>{node.node_type}</b> {node.title}</li>)}{proposal.candidate.proposed_edges.map((edge, index) => <li key={`${edge.source_key}-${edge.target_key}-${index}`}>{edge.source_key} {edge.edge_type.replaceAll("_", " ")} {edge.target_key}</li>)}</ul>
      <div className="panel-actions"><button disabled={accepting} onClick={() => onAccept(proposal.id)} type="button">Accept proposal</button><button disabled={accepting} onClick={() => onReject(proposal.id)} type="button">Reject proposal</button></div></motion.article>)}</AnimatePresence>
  </section>;
}
