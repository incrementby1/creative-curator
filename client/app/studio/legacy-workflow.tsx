"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "../page.module.css";

type ToneSlider = {
  label: string;
  left: string;
  right: string;
  value: number;
};

type BrandDna = {
  beliefs: string[];
  tone_sliders: ToneSlider[];
};

type Direction = {
  id: number;
  name: string;
  tone: string;
  visual_style: string;
  creative_intent: string;
  palette: string[];
  channels: string[];
  why_it_works: string;
};

type RejectionReason =
  | "too_generic"
  | "too_loud"
  | "not_our_audience"
  | "not_authentic"
  | "other";

type Rejection = {
  direction_id: number;
  reason: RejectionReason;
  note?: string | null;
};

type RefinedDirection = Direction & {
  since_rejected?: string | null;
  since_you_rejected?: string | null;
  change_summary?: string | null;
};

type Artifact = {
  caption: string;
  layout_mock_svg: string;
  rationale: [string, string, string];
};

type CreativeSession = {
  session_id: string;
  brand_name: string;
  description: string;
  goal: string | null;
  reference: string | null;
  dna: BrandDna;
  directions: Direction[];
  status: "active" | "refined_ready" | "approved" | "executed";
  rejections: Rejection[];
  constraints: string[];
  refined_direction: RefinedDirection | null;
  artifact: Artifact | null;
};

type ExecuteResponse = {
  session_id: string;
  status: string;
  artifact: Artifact;
  direction: Direction;
};

type RejectionDraft = {
  selected: boolean;
  reason: RejectionReason;
  note: string;
};

const REJECTION_REASONS: Array<{ value: RejectionReason; label: string }> = [
  { value: "too_generic", label: "Too generic" },
  { value: "too_loud", label: "Too loud" },
  { value: "not_our_audience", label: "Not our audience" },
  { value: "not_authentic", label: "Not authentic" },
  { value: "other", label: "Other" },
];

function postJson<T>(path: string, body: object): Promise<T> {
  return fetch(`/api/creative${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.detail ?? "The creative service is unavailable.");
    }
    return payload as T;
  });
}

function buildDrafts(directions: Direction[]): Record<number, RejectionDraft> {
  return Object.fromEntries(
    directions.map((direction) => [direction.id, { selected: false, reason: "too_generic", note: "" }]),
  ) as Record<number, RejectionDraft>;
}

function describeStatus(status: CreativeSession["status"]) {
  return status.replace("_", " ");
}

export default function Home() {
  const [brandName, setBrandName] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [goal, setGoal] = useState("");
  const [session, setSession] = useState<CreativeSession | null>(null);
  const [finalResult, setFinalResult] = useState<ExecuteResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<number, RejectionDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedCount = useMemo(
    () => Object.values(drafts).filter((draft) => draft.selected).length,
    [drafts],
  );

  const selectedDrafts = useMemo(() => {
    if (!session) return [];
    return session.directions
      .filter((direction) => drafts[direction.id]?.selected)
      .map((direction) => ({ direction, draft: drafts[direction.id]! }));
  }, [drafts, session]);

  async function startSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await postJson<CreativeSession>("/start", {
        brand_name: brandName.trim(),
        description: description.trim(),
        goal: goal.trim() || null,
        reference: reference.trim() || null,
      });
      setSession(result);
      setFinalResult(null);
      setDrafts(buildDrafts(result.directions));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRejections(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;

    if (selectedCount !== 2) {
      setError("Select exactly 2 directions to reject.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await postJson<CreativeSession>("/reject", {
        session_id: session.session_id,
        rejections: selectedDrafts.map(({ direction, draft }) => ({
          direction_id: direction.id,
          reason: draft.reason,
          note: draft.note.trim() || null,
        })),
      });
      setSession(result);
      setDrafts(buildDrafts(result.directions));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function approveAndExecute() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const approved = await postJson<CreativeSession>("/approve", { session_id: session.session_id });
      setSession(approved);
      const executed = await postJson<ExecuteResponse>("/execute", { session_id: approved.session_id });
      setSession((current) =>
        current ? { ...current, status: "executed", artifact: executed.artifact } : current,
      );
      setFinalResult(executed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSession(null);
    setFinalResult(null);
    setDrafts({});
    setError("");
  }

  const refinedDirection = session?.refined_direction;
  const artifact = finalResult?.artifact;

  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="Primary">
        <a className={styles.wordmark} href="#top">
          Creative Curator
        </a>
        <span className={styles.badge}>Backend-driven MVP</span>
      </nav>

      <section className={styles.hero} id="top">
        <p className={styles.eyebrow}>Creative direction loop</p>
        <h1>Brief in, three directions out, then refine the best one.</h1>
        <p className={styles.heroCopy}>
          Start with a brand name and a one-sentence brief. Review the brand DNA, reject two
          directions with structured feedback, and ship a final artifact.
        </p>
      </section>

      {!session && (
        <section className={styles.panel} aria-labelledby="brief-title">
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>01 / Intake</p>
              <h2 id="brief-title">Create a session</h2>
            </div>
          </header>
          <form className={styles.form} onSubmit={startSession}>
            <label className={styles.field}>
              <span>Brand name</span>
              <input
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
                placeholder="Northstar Coffee"
                maxLength={80}
                required
              />
            </label>
            <label className={styles.field}>
              <span>One-sentence description</span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="A premium coffee brand for busy city mornings."
                maxLength={180}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Optional reference</span>
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Caption, feel, or example"
                maxLength={180}
              />
            </label>
            <label className={styles.field}>
              <span>Optional goal</span>
              <input
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="What outcome should this drive?"
                maxLength={180}
              />
            </label>
            <button className={styles.primaryButton} disabled={busy} type="submit">
              {busy ? "Starting…" : "Generate directions"}
            </button>
          </form>
        </section>
      )}

      {session && (
        <section className={styles.panel}>
          <header className={styles.sessionHeader}>
            <div>
              <p className={styles.eyebrow}>02 / Session</p>
              <h2>{session.brand_name}</h2>
              <p className={styles.sessionCopy}>{session.description}</p>
            </div>
            <div className={styles.sessionMeta}>
              <span className={styles.badge}>{describeStatus(session.status)}</span>
              <button className={styles.textButton} onClick={reset} type="button">
                Start over
              </button>
            </div>
          </header>

          <section className={styles.subsection} aria-labelledby="dna-title">
            <div className={styles.subsectionHeader}>
              <div>
                <p className={styles.eyebrow}>Brand DNA hypothesis</p>
                <h3 id="dna-title">Beliefs and tone sliders</h3>
              </div>
            </div>
            <div className={styles.dnaGrid}>
              <div className={styles.beliefs}>
                {session.dna.beliefs.map((belief) => (
                  <div key={belief} className={styles.beliefItem}>
                    {belief}
                  </div>
                ))}
              </div>
              <div className={styles.sliderList}>
                {session.dna.tone_sliders.map((slider) => (
                  <div key={slider.label} className={styles.sliderRow}>
                    <div className={styles.sliderLabels}>
                      <strong>{slider.label}</strong>
                      <span>
                        {slider.left} · {slider.right}
                      </span>
                    </div>
                    <div className={styles.sliderTrack} aria-hidden="true">
                      <span className={styles.sliderFill} style={{ width: `${slider.value}%` }} />
                      <span className={styles.sliderThumb} style={{ left: `${slider.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {session.constraints.length > 0 && (
              <div className={styles.tags}>
                {session.constraints.map((constraint) => (
                  <span key={constraint}>{constraint}</span>
                ))}
              </div>
            )}
          </section>

          <section className={styles.subsection} aria-labelledby="directions-title">
            <div className={styles.subsectionHeader}>
              <div>
                <p className={styles.eyebrow}>03 / Directions</p>
                <h3 id="directions-title">Review the three options</h3>
              </div>
              <span className={styles.helper}>Reject exactly 2 to unlock refinement.</span>
            </div>

            <div className={styles.cardsGrid}>
              {session.directions.map((direction) => (
                <article className={styles.card} key={direction.id}>
                  <div className={styles.cardTop}>
                    <span className={styles.cardIndex}>0{direction.id}</span>
                    <span className={styles.smallLabel}>{direction.tone}</span>
                  </div>
                  <h4>{direction.name}</h4>
                  <p className={styles.cardText}>{direction.visual_style}</p>
                  <div className={styles.detailBlock}>
                    <strong>Creative intent</strong>
                    <p>{direction.creative_intent}</p>
                  </div>
                  <div className={styles.detailBlock}>
                    <strong>Why it works</strong>
                    <p>{direction.why_it_works}</p>
                  </div>
                  <div className={styles.pillRow}>
                    {direction.palette.map((color) => (
                      <span key={color} className={styles.colorPill}>
                        <i style={{ backgroundColor: color }} /> {color}
                      </span>
                    ))}
                  </div>
                  <div className={styles.tags}>
                    {direction.channels.map((channel) => (
                      <span key={channel}>{channel}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {session.status === "active" && (
            <section className={styles.subsection} aria-labelledby="reject-title">
              <div className={styles.subsectionHeader}>
                <div>
                  <p className={styles.eyebrow}>04 / Rejection core</p>
                  <h3 id="reject-title">Pick exactly two directions to reject</h3>
                </div>
                <span className={styles.helper}>{selectedCount}/2 selected</span>
              </div>

              <form className={styles.rejectForm} onSubmit={submitRejections}>
                {session.directions.map((direction) => {
                  const draft = drafts[direction.id] ?? {
                    selected: false,
                    reason: "too_generic" as RejectionReason,
                    note: "",
                  };
                  const disabled = busy || (!draft.selected && selectedCount >= 2);

                  return (
                    <div className={styles.rejectItem} key={direction.id}>
                      <label className={styles.rejectToggle}>
                        <input
                          checked={draft.selected}
                          disabled={busy || (!draft.selected && selectedCount >= 2)}
                          onChange={(event) => {
                            const selected = event.target.checked;
                            setDrafts((current) => ({
                              ...current,
                              [direction.id]: {
                                ...draft,
                                selected,
                              },
                            }));
                          }}
                          type="checkbox"
                        />
                        <span>
                          <strong>{direction.name}</strong>
                          <small>{direction.tone}</small>
                        </span>
                      </label>

                      <div className={styles.rejectControls}>
                        <label className={styles.field}>
                          <span>Reason</span>
                          <select
                            disabled={disabled}
                            value={draft.reason}
                            onChange={(event) => {
                              const reason = event.target.value as RejectionReason;
                              setDrafts((current) => ({
                                ...current,
                                [direction.id]: { ...draft, reason },
                              }));
                            }}
                          >
                            {REJECTION_REASONS.map((reason) => (
                              <option key={reason.value} value={reason.value}>
                                {reason.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className={styles.field}>
                          <span>Optional note</span>
                          <textarea
                            disabled={disabled}
                            placeholder="Add a short note for the refinement pass"
                            rows={3}
                            value={draft.note}
                            onChange={(event) => {
                              const note = event.target.value;
                              setDrafts((current) => ({
                                ...current,
                                [direction.id]: { ...draft, note },
                              }));
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}

                <button className={styles.primaryButton} disabled={busy} type="submit">
                  {busy ? "Sending…" : "Send 2 rejections"}
                </button>
              </form>
            </section>
          )}

          {refinedDirection && (
            <section className={styles.refinedCard} aria-labelledby="refined-title">
              <div>
                <p className={styles.eyebrow}>05 / Refined direction</p>
                <h3 id="refined-title">{refinedDirection.name}</h3>
                <p className={styles.sessionCopy}>{refinedDirection.tone}</p>
              </div>
              <p className={styles.refinedNote}>{refinedDirection.visual_style}</p>
              <div className={styles.detailBlock}>
                <strong>What changed</strong>
                <p>{refinedDirection.why_it_works}</p>
              </div>
              {(
                refinedDirection.since_rejected ||
                refinedDirection.since_you_rejected ||
                refinedDirection.change_summary
              ) && (
                <p className={styles.callout}>
                  Since you rejected the first pass, {refinedDirection.since_rejected ?? refinedDirection.since_you_rejected ?? refinedDirection.change_summary}
                </p>
              )}
              <div className={styles.tags}>
                {refinedDirection.channels.map((channel) => (
                  <span key={channel}>{channel}</span>
                ))}
              </div>
              <button className={styles.primaryButton} disabled={busy} onClick={approveAndExecute} type="button">
                {busy ? "Working…" : "Approve refined direction & generate artifact"}
              </button>
            </section>
          )}

          {artifact && (
            <section className={styles.artifactCard} aria-labelledby="artifact-title">
              <div>
                <p className={styles.eyebrow}>06 / Final artifact</p>
                <h3 id="artifact-title">{finalResult?.direction.name ?? refinedDirection?.name}</h3>
                <p className={styles.sessionCopy}>{artifact.caption}</p>
              </div>
              <div className={styles.svgWrap} dangerouslySetInnerHTML={{ __html: artifact.layout_mock_svg }} />
              <ul className={styles.bullets}>
                {artifact.rationale.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}

      <div className={styles.error} role="status" aria-live="polite">
        {error}
      </div>
      <footer className={styles.footer}>Creative Curator · single-page backend loop.</footer>
    </main>
  );
}
