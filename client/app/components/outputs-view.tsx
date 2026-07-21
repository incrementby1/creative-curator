"use client";

import Image from "next/image";
import { type FormEvent, useMemo, useState } from "react";
import type { Direction, RejectionReason } from "../lib/creative-api";
import styles from "../page.module.css";
import { useWorkspace } from "./workspace-context";

type RejectionDraft = {
  selected: boolean;
  reason: RejectionReason;
  note: string;
};

const REJECTION_REASONS: Array<{ label: string; value: RejectionReason }> = [
  { label: "Too generic", value: "too_generic" },
  { label: "Too loud", value: "too_loud" },
  { label: "Not our audience", value: "not_our_audience" },
  { label: "Not authentic", value: "not_authentic" },
  { label: "Other", value: "other" },
];

function buildDrafts(directions: Direction[]): Record<number, RejectionDraft> {
  return Object.fromEntries(
    directions.map((direction) => [
      direction.id,
      { selected: false, reason: "too_generic", note: "" },
    ]),
  ) as Record<number, RejectionDraft>;
}

function DirectionDetails({ direction }: { direction: Direction }) {
  return (
    <>
      <p className={styles.directionTone}>{direction.tone}</p>
      <div className={styles.directionBody}>
        <div>
          <span className={styles.sectionLabel}>Visual language</span>
          <p>{direction.visual_style}</p>
        </div>
        <div>
          <span className={styles.sectionLabel}>Creative intent</span>
          <p>{direction.creative_intent}</p>
        </div>
        <div>
          <span className={styles.sectionLabel}>Why it works</span>
          <p>{direction.why_it_works}</p>
        </div>
      </div>
      <div className={styles.directionFooter}>
        <div>
          <span className={styles.sectionLabel}>Palette</span>
          <div className={styles.palette}>
            {direction.palette.map((color) => (
              <span key={color} title={color}>
                <i style={{ backgroundColor: color }} />
                {color}
              </span>
            ))}
          </div>
        </div>
        <div>
          <span className={styles.sectionLabel}>Channels</span>
          <div className={styles.channels}>
            {direction.channels.map((channel) => <span key={channel}>{channel}</span>)}
          </div>
        </div>
      </div>
    </>
  );
}

export default function OutputsView() {
  const { approveAndExecute, operation, reject, retryExecute, session } = useWorkspace();
  const [drafts, setDrafts] = useState<Record<number, RejectionDraft>>(() =>
    buildDrafts(session?.directions ?? []),
  );
  const selectedCount = useMemo(
    () => Object.values(drafts).filter((draft) => draft.selected).length,
    [drafts],
  );
  const busy = operation !== null;

  if (!session) {
    return (
      <section className={styles.lockedView} aria-labelledby="outputs-title">
        <p className={styles.eyebrow}>03 / Creative directions</p>
        <h1 id="outputs-title">Three creative directions</h1>
        <p>Complete the brief to unlock three distinct ways forward.</p>
      </section>
    );
  }

  function changeDraft(directionId: number, change: Partial<RejectionDraft>) {
    setDrafts((current) => ({
      ...current,
      [directionId]: { ...current[directionId], ...change },
    }));
  }

  function submitRejections(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedCount !== 2) return;

    const rejections = session!.directions
      .filter((direction) => drafts[direction.id]?.selected)
      .map((direction) => ({
        direction_id: direction.id,
        reason: drafts[direction.id].reason,
        note: drafts[direction.id].note.trim() || null,
      }));

    void reject(rejections);
  }

  if (session.status === "executed" && session.artifact) {
    const artifactSource = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(session.artifact.layout_mock_svg)}`;
    return (
      <section className={styles.view} aria-labelledby="artifact-title">
        <header className={styles.viewHeader}>
          <div>
            <p className={styles.eyebrow}>05 / Ready to make</p>
            <h1 id="artifact-title">Final artifact</h1>
            <p>One focused expression of the direction that survived the edit.</p>
          </div>
          <span className={styles.completeBadge}>Complete</span>
        </header>

        <article className={styles.artifactLayout}>
          <div className={styles.artifactVisual}>
            <Image
              alt="Generated creative layout"
              height={1080}
              src={artifactSource}
              unoptimized
              width={1080}
            />
          </div>
          <div className={styles.artifactCopy}>
            <span className={styles.sectionLabel}>Caption</span>
            <h2>{session.artifact.caption}</h2>
            <span className={styles.sectionLabel}>Rationale</span>
            <ol>
              {session.artifact.rationale.map((reason, index) => (
                <li key={`${reason}-${index}`}><span>0{index + 1}</span>{reason}</li>
              ))}
            </ol>
          </div>
        </article>
      </section>
    );
  }

  if (session.status === "approved") {
    return (
      <section className={styles.lockedView} aria-labelledby="approved-title">
        <p className={styles.eyebrow}>05 / Direction approved</p>
        <h1 id="approved-title">Artifact generation paused.</h1>
        <p>The direction is safe. Retry the final generation when the service is ready.</p>
        <button className={styles.primaryButton} disabled={busy} onClick={() => void retryExecute()} type="button">
          {operation === "execute" ? "Generating artifact…" : "Generate artifact"}
        </button>
      </section>
    );
  }

  if (session.status === "refined_ready") {
    return (
      <section className={styles.view} aria-labelledby="refined-title">
        <header className={styles.viewHeader}>
          <div>
            <p className={styles.eyebrow}>04 / The surviving idea</p>
            <h1 id="refined-title">Refined creative direction</h1>
            <p>Hermes used both rejections as creative constraints—not as a request to average the ideas.</p>
          </div>
        </header>

        <div className={styles.refinedLayout}>
          {session.refined_direction ? (
            <article className={styles.refinedCard}>
              <span className={styles.sectionLabel}>Chosen direction</span>
              <p className={styles.refinedName}>{session.refined_direction.name}</p>
              <DirectionDetails direction={session.refined_direction} />
            </article>
          ) : (
            <p>Refined direction is unavailable.</p>
          )}
          <aside className={styles.constraintCard}>
            <span className={styles.sectionLabel}>Constraints carried forward</span>
            <ol>
              {session.constraints.map((constraint, index) => (
                <li key={`${constraint}-${index}`}><span>0{index + 1}</span>{constraint}</li>
              ))}
            </ol>
            <button
              className={styles.primaryButton}
              disabled={busy || !session.refined_direction}
              onClick={() => void approveAndExecute()}
              type="button"
            >
              {busy ? "Approving and generating…" : "Approve and generate artifact"}
            </button>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.view} aria-labelledby="outputs-title">
      <header className={styles.viewHeader}>
        <div>
          <p className={styles.eyebrow}>03 / Diverge, then decide</p>
          <h1 id="outputs-title">Three creative directions</h1>
          <p>Reject exactly two. The reasons become boundaries for the direction that remains.</p>
        </div>
        <span className={styles.selectionBadge}>{selectedCount} / 2 rejected</span>
      </header>

      <form className={styles.directionsForm} onSubmit={submitRejections}>
        <div className={styles.directionGrid}>
          {session.directions.map((direction, index) => {
            const draft = drafts[direction.id];
            const selectionLocked = selectedCount >= 2 && !draft?.selected;
            return (
              <article
                className={`${styles.directionCard} ${draft?.selected ? styles.directionRejected : ""}`}
                data-direction-id={direction.id}
                key={direction.id}
              >
                <div className={styles.directionHeading}>
                  <span>Direction 0{index + 1}</span>
                  <label className={styles.rejectCheck}>
                    <input
                      aria-label={`Reject ${direction.name}`}
                      checked={draft?.selected ?? false}
                      disabled={busy || selectionLocked}
                      onChange={(event) => changeDraft(direction.id, { selected: event.target.checked })}
                      type="checkbox"
                    />
                    <span>Reject</span>
                  </label>
                </div>
                <h2>{direction.name}</h2>
                <DirectionDetails direction={direction} />

                {draft?.selected && (
                  <div className={styles.rejectionFields}>
                    <label className={styles.field}>
                      <span>Rejection reason</span>
                      <select
                        disabled={busy}
                        onChange={(event) => changeDraft(direction.id, { reason: event.target.value as RejectionReason })}
                        value={draft.reason}
                      >
                        {REJECTION_REASONS.map((reason) => (
                          <option key={reason.value} value={reason.value}>{reason.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Optional note</span>
                      <textarea
                        disabled={busy}
                        onChange={(event) => changeDraft(direction.id, { note: event.target.value })}
                        placeholder="What specifically misses?"
                        rows={3}
                        value={draft.note}
                      />
                    </label>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <div className={styles.refineBar}>
          <p>{selectedCount === 2 ? "Two clear boundaries. Ready to refine." : "Choose two directions to reject."}</p>
          <button className={styles.primaryButton} disabled={selectedCount !== 2 || busy} type="submit">
            {operation === "reject" ? "Refining direction…" : "Refine remaining direction"}
          </button>
        </div>
      </form>
    </section>
  );
}
