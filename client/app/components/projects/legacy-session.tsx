"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useAuth } from "../auth/auth-provider";
import { getLegacySession, type LegacyCreativeSession } from "../../lib/creative-api";
import styles from "../../styles/projects.module.css";

export function LegacySession({ sessionId }: { sessionId: string }) {
  const { client, ready } = useAuth();
  const [session, setSession] = useState<LegacyCreativeSession | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ready || !client) return;
    let active = true;
    void getLegacySession(sessionId, client).then((value) => { if (active) setSession(value); }).catch(() => { if (active) setError("Legacy session was not found or is unavailable."); });
    return () => { active = false; };
  }, [client, ready, sessionId]);
  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!session) return <p className={styles.status} role="status">Loading legacy session…</p>;
  const artifactSource = session.artifact ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(session.artifact.layout_mock_svg)}` : null;
  return <article className={styles.legacyPage}>
    <header className={styles.legacyHero}><p className={styles.legacyBadge}>Read-only legacy session</p><h1>{session.brand_name}</h1><p>{session.description}</p>{session.goal ? <p><strong>Goal</strong> {session.goal}</p> : null}</header>
    <section className={styles.legacyPanel} aria-labelledby="legacy-dna"><h2 id="legacy-dna">Brand DNA</h2><h3>Beliefs</h3><ul>{session.dna.beliefs.map((belief) => <li key={belief}>{belief}</li>)}</ul><div className={styles.legacySliders}>{session.dna.tone_sliders.map((tone) => <p key={tone.label}><strong>{tone.label}</strong><span>{tone.left} · {tone.value} · {tone.right}</span></p>)}</div></section>
    <section className={styles.legacyPanel} aria-labelledby="legacy-directions"><h2 id="legacy-directions">Creative directions</h2><div className={styles.legacyCards}>{session.directions.map((direction) => <article key={direction.id}><p className={styles.index}>Direction {direction.id}</p><h3>{direction.name}</h3><p>{direction.creative_intent}</p><dl><dt>Tone</dt><dd>{direction.tone}</dd><dt>Visual style</dt><dd>{direction.visual_style}</dd><dt>Why it works</dt><dd>{direction.why_it_works}</dd></dl></article>)}</div></section>
    {session.refined_direction ? <section className={styles.legacyPanel} aria-labelledby="legacy-refinement"><h2 id="legacy-refinement">Refined direction</h2><h3>{session.refined_direction.name}</h3><p>{session.refined_direction.creative_intent}</p>{session.constraints.length ? <><h3>Constraints</h3><ul>{session.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul></> : null}</section> : null}
    {session.artifact && artifactSource ? <section className={styles.legacyPanel} aria-labelledby="legacy-artifact"><h2 id="legacy-artifact">Final artifact</h2><Image unoptimized className={styles.legacyArtifact} width={1200} height={800} src={artifactSource} alt={`Saved artifact for ${session.brand_name}`} /><h3>{session.artifact.caption}</h3><ul>{session.artifact.rationale.map((reason) => <li key={reason}>{reason}</li>)}</ul></section> : null}
  </article>;
}
