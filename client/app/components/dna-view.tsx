"use client";

import styles from "../page.module.css";
import { useWorkspace } from "./workspace-context";

function clamp(value: number) {
  return Math.min(100, Math.max(0, value));
}

export default function DnaView() {
  const { session } = useWorkspace();

  if (!session) {
    return (
      <section className={styles.lockedView} aria-labelledby="dna-title">
        <p className={styles.eyebrow}>02 / Brand hypothesis</p>
        <h1 id="dna-title">Brand DNA</h1>
        <p>Complete the brief to unlock Hermes&apos; working brand hypothesis.</p>
      </section>
    );
  }

  return (
    <section className={styles.view} aria-labelledby="dna-title">
      <header className={styles.viewHeader}>
        <div>
          <p className={styles.eyebrow}>02 / Read the hypothesis</p>
          <h1 id="dna-title">Brand DNA</h1>
          <p>Not a permanent rulebook—just the beliefs and tonal tension guiding this round.</p>
        </div>
        <span className={styles.readOnlyBadge}>Read only</span>
      </header>

      <div className={styles.dnaLayout}>
        <div className={styles.beliefStack}>
          <p className={styles.sectionLabel}>Core beliefs</p>
          {session.dna.beliefs.map((belief, index) => (
            <article className={styles.beliefCard} key={`${belief}-${index}`}>
              <span>0{index + 1}</span>
              <p>{belief}</p>
            </article>
          ))}
        </div>

        <div className={styles.toneSheet}>
          <p className={styles.sectionLabel}>Tone calibration</p>
          {session.dna.tone_sliders.map((slider) => {
            const value = clamp(slider.value);
            return (
              <div className={styles.toneRow} key={slider.label}>
                <div className={styles.toneTitle}>
                  <h2>{slider.label}</h2>
                  <span>{value}</span>
                </div>
                <div
                  aria-label={`${slider.label}: ${value} out of 100, from ${slider.left} to ${slider.right}`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={value}
                  className={styles.toneTrack}
                  role="meter"
                >
                  <i style={{ width: `${value}%` }} />
                  <b style={{ left: `${value}%` }} />
                </div>
                <div className={styles.toneEnds}>
                  <span>{slider.left}</span>
                  <span>{slider.right}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
