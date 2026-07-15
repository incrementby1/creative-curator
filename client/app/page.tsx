"use client";

import { FormEvent, useState } from "react";
import styles from "./page.module.css";

type Direction = {
  id: number;
  title: string;
  concept: string;
  why_it_works: string;
  palette: string[];
  channels: string[];
};

type CreativeSession = {
  session_id: string;
  brand_id: string;
  goal: string;
  directions: Direction[];
  round: number;
  status: "active" | "approved";
  feedback: string[];
};

type Deployment = {
  status: "approved";
  direction: Direction;
  next_steps: string[];
};

async function postJson<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`/api/creative${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail ?? "The creative service is unavailable.");
  }
  return payload as T;
}

export default function Home() {
  const [brandId, setBrandId] = useState("");
  const [goal, setGoal] = useState("");
  const [feedback, setFeedback] = useState("");
  const [session, setSession] = useState<CreativeSession | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function runAction<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await runAction(() =>
      postJson<CreativeSession>("/start", { brand_id: brandId, goal }),
    );
    if (result) setSession(result);
  }

  async function requestRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const result = await runAction(() =>
      postJson<CreativeSession>("/reject", {
        session_id: session.session_id,
        reasons: [feedback],
      }),
    );
    if (result) {
      setSession(result);
      setFeedback("");
    }
  }

  async function approve(choiceId: number) {
    if (!session) return;
    const result = await runAction(() =>
      postJson<Deployment>("/approve", {
        session_id: session.session_id,
        choice_id: choiceId,
      }),
    );
    if (result) setDeployment(result);
  }

  function reset() {
    setSession(null);
    setDeployment(null);
    setFeedback("");
    setError("");
  }

  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="Main navigation">
        <a className={styles.wordmark} href="#top" aria-label="Creative Curator home">
          <span aria-hidden="true">C/C</span>
          Creative Curator
        </a>
        <span className={styles.status}><i /> Direction studio · alpha</span>
      </nav>

      <section className={styles.hero} id="top">
        <div className={styles.eyebrow}>A sharper starting point</div>
        <h1>Turn a creative goal into <em>three clear directions.</em></h1>
        <p>
          Give the studio a brand and an outcome. Get distinct campaign routes,
          refine them with feedback, and approve the strongest idea.
        </p>
      </section>

      {!session && !deployment && (
        <section className={styles.workspace} aria-labelledby="brief-title">
          <div className={styles.stepLabel}>01 / The brief</div>
          <form className={styles.briefForm} onSubmit={startSession}>
            <div className={styles.field}>
              <label htmlFor="brand">Brand or project</label>
              <input
                id="brand"
                value={brandId}
                onChange={(event) => setBrandId(event.target.value)}
                placeholder="e.g. Northstar Coffee"
                maxLength={80}
                required
              />
            </div>
            <div className={`${styles.field} ${styles.goalField}`}>
              <label htmlFor="goal" id="brief-title">What needs to change?</label>
              <textarea
                id="goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="e.g. Make our summer launch feel essential to first-time buyers"
                minLength={10}
                maxLength={500}
                rows={3}
                required
              />
              <span className={styles.counter}>{goal.length} / 500</span>
            </div>
            <button className={styles.primaryButton} disabled={busy} type="submit">
              {busy ? "Building directions…" : "Build the first round"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>
      )}

      {session && !deployment && (
        <section className={styles.results} aria-labelledby="directions-title">
          <header className={styles.resultsHeader}>
            <div>
              <div className={styles.stepLabel}>02 / Round {session.round}</div>
              <h2 id="directions-title">Choose a territory to develop.</h2>
            </div>
            <button className={styles.textButton} onClick={reset} type="button">
              Edit brief
            </button>
          </header>
          <div className={styles.cards}>
            {session.directions.map((direction, index) => (
              <article className={styles.card} key={direction.id}>
                <div className={styles.cardTopline}>
                  <span>0{index + 1}</span>
                  <div className={styles.swatches} aria-label="Suggested color palette">
                    {direction.palette.map((color) => (
                      <i key={color} style={{ backgroundColor: color }} title={color} />
                    ))}
                  </div>
                </div>
                <h3>{direction.title}</h3>
                <p className={styles.concept}>{direction.concept}</p>
                <div className={styles.rationale}>
                  <strong>Why it works</strong>
                  <p>{direction.why_it_works}</p>
                </div>
                <div className={styles.tags}>
                  {direction.channels.map((channel) => <span key={channel}>{channel}</span>)}
                </div>
                <button
                  className={styles.cardButton}
                  disabled={busy}
                  onClick={() => approve(direction.id)}
                  type="button"
                >
                  Approve this direction <span aria-hidden="true">↗</span>
                </button>
              </article>
            ))}
          </div>
          <form className={styles.revision} onSubmit={requestRevision}>
            <div>
              <label htmlFor="feedback">None of these quite land?</label>
              <p>Tell the studio what to change and generate a tighter round.</p>
            </div>
            <input
              id="feedback"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="More editorial, less playful…"
              maxLength={240}
              required
            />
            <button disabled={busy} type="submit">Revise all three</button>
          </form>
        </section>
      )}

      {deployment && (
        <section className={styles.approved} aria-labelledby="approved-title">
          <div className={styles.approvedMark} aria-hidden="true">✓</div>
          <div>
            <div className={styles.eyebrow}>Direction approved</div>
            <h2 id="approved-title">{deployment.direction.title}</h2>
            <p>{deployment.direction.concept}</p>
          </div>
          <ol>
            {deployment.next_steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <button className={styles.primaryButton} onClick={reset} type="button">
            Start another brief <span aria-hidden="true">→</span>
          </button>
        </section>
      )}

      <div className={styles.error} role="status" aria-live="polite">
        {error}
      </div>
      <footer>Creative Curator · A focused loop from brief to direction.</footer>
    </main>
  );
}
