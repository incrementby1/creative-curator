"use client";

import { type FormEvent, useState } from "react";
import styles from "../page.module.css";
import { useWorkspace } from "./workspace-context";

export default function BriefView() {
  const { session, operation, reset, start } = useWorkspace();
  const [brandName, setBrandName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [reference, setReference] = useState("");
  const busy = operation === "start";

  function submitBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void start({
      brand_name: brandName.trim(),
      description: description.trim(),
      goal: goal.trim() || null,
      reference: reference.trim() || null,
    });
  }

  if (session) {
    return (
      <section className={styles.view} aria-labelledby="brief-title">
        <header className={styles.viewHeader}>
          <div>
            <p className={styles.eyebrow}>01 / The starting point</p>
            <h1 id="brief-title">Creative brief</h1>
            <p>Your working brief stays fixed while Hermes develops and refines the directions.</p>
          </div>
          <button className={styles.textButton} onClick={reset} type="button">
            Start over
          </button>
        </header>

        <article className={styles.briefSummary}>
          <div className={styles.summaryLead}>
            <span>Brand</span>
            <h2>{session.brand_name}</h2>
            <p>{session.description}</p>
          </div>
          <dl className={styles.summaryDetails}>
            <div>
              <dt>Goal</dt>
              <dd>{session.goal ?? "Open exploration"}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>{session.reference ?? "No reference supplied"}</dd>
            </div>
          </dl>
        </article>
      </section>
    );
  }

  return (
    <section className={styles.view} aria-labelledby="brief-title">
      <header className={styles.introHeader}>
        <p className={styles.eyebrow}>01 / Begin with what matters</p>
        <h1 id="brief-title">Shape the brief.</h1>
        <p>
          A lean brief gives Hermes enough structure to find three genuinely different ways forward.
        </p>
      </header>

      <form className={styles.briefForm} onSubmit={submitBrief}>
        <div className={styles.formIntro}>
          <span>Working note</span>
          <p>Write plainly. Specific intent beats polished marketing language.</p>
        </div>

        <div className={styles.formFields}>
          <label className={styles.field}>
            <span>Brand name</span>
            <input
              autoComplete="organization"
              maxLength={80}
              onChange={(event) => setBrandName(event.target.value)}
              placeholder="Northstar Coffee"
              required
              value={brandName}
            />
          </label>

          <label className={styles.field}>
            <span>One-sentence description</span>
            <textarea
              maxLength={280}
              minLength={5}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A premium coffee brand for busy city mornings."
              required
              rows={4}
              value={description}
            />
            <small>{description.length} / 280</small>
          </label>

          <div className={styles.fieldPair}>
            <label className={styles.field}>
              <span>Optional goal</span>
              <input
                maxLength={500}
                minLength={10}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Increase qualified local visits"
                value={goal}
              />
            </label>

            <label className={styles.field}>
              <span>Optional reference</span>
              <input
                maxLength={240}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Warm, useful, and confident"
                value={reference}
              />
            </label>
          </div>

          <div className={styles.formAction}>
            <p>Three directions, then one focused rejection round.</p>
            <button className={styles.primaryButton} disabled={busy} type="submit">
              {busy ? "Generating directions…" : "Generate directions"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
