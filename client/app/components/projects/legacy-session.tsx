"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useAuth } from "../auth/auth-provider";
import {
  getLegacySession,
  type Direction,
  type LegacyCreativeSession,
} from "../../lib/creative-api";
import styles from "../../styles/projects.module.css";

function SavedDirection({ direction }: { direction: Direction }) {
  return (
    <>
      <h3>{direction.name}</h3>
      <dl>
        <dt>Creative intent</dt><dd>{direction.creative_intent}</dd>
        <dt>Tone</dt><dd>{direction.tone}</dd>
        <dt>Visual style</dt><dd>{direction.visual_style}</dd>
        <dt>Why it works</dt><dd>{direction.why_it_works}</dd>
      </dl>
      <h4>Palette</h4>
      <ul className={styles.legacyPalette} aria-label={`${direction.name} palette`}>
        {direction.palette.map((color) => (
          <li key={color}><span aria-hidden="true" style={{ backgroundColor: color }} />{color}</li>
        ))}
      </ul>
      <h4>Channels</h4>
      <ul className={styles.legacyChannels} aria-label={`${direction.name} channels`}>
        {direction.channels.map((channel) => <li key={channel}>{channel}</li>)}
      </ul>
    </>
  );
}

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
    <section className={styles.legacyPanel} aria-labelledby="legacy-directions"><h2 id="legacy-directions">Creative directions</h2><div className={styles.legacyCards}>{session.directions.map((direction) => <article key={direction.id}><p className={styles.index}>Direction {direction.id}</p><SavedDirection direction={direction} /></article>)}</div></section>
    {session.refined_direction ? <section className={styles.legacyPanel} aria-labelledby="legacy-refinement"><h2 id="legacy-refinement">Refined direction</h2><SavedDirection direction={session.refined_direction} />{session.constraints.length ? <><h3>Constraints</h3><ul>{session.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul></> : null}</section> : null}
    {session.artifact && artifactSource ? <section className={styles.legacyPanel} aria-labelledby="legacy-artifact"><h2 id="legacy-artifact">Final artifact</h2><Image unoptimized className={styles.legacyArtifact} width={1200} height={800} src={artifactSource} alt={`Saved artifact for ${session.brand_name}`} /><h3>Caption</h3><p>{session.artifact.caption}</p><h3>Rationale</h3><ol>{session.artifact.rationale.map((reason) => <li key={reason}>{reason}</li>)}</ol></section> : null}
  </article>;
}
