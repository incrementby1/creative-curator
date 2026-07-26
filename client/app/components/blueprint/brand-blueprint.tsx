"use client";

import Link from "next/link";
import { Download, GitBranch, History } from "lucide-react";
import type { BlueprintSnapshot } from "../../lib/project-types";
import { BlueprintSection } from "./blueprint-section";

const SECTIONS = [
  ["purpose", "Brand idea & purpose", "Core belief, reason to exist, and value created."],
  ["audience", "Target audience & central tension", "Who this is for and the tension the brand must resolve."],
  ["positioning", "Positioning & differentiation", "Defensible place in the market and meaningful distinction."],
  ["promise", "Brand promise", "Experience the brand commits to deliver consistently."],
  ["personality-voice", "Personality & voice", "Character, language, and behavioral guardrails."],
  ["naming", "Naming territory & shortlist", "Naming principles, territories, and candidate names."],
  ["messaging", "Messaging pillars & sample tagline", "Message architecture and an illustrative expression."],
  ["visual-direction", "Visual direction", "Palette, typography, imagery, and logo brief."],
  ["evidence-assumptions", "Evidence & assumptions", "Known support separated from hypotheses still needing proof."],
  ["unresolved-challenges", "Unresolved Hermes challenges", "Open creative-director challenges and their downstream risk."],
  ["next-actions", "Recommended next actions", "Practical sequence for strengthening and activating the brand."],
] as const;

const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value));
const sequence = (value: number) => value.toString().padStart(2, "0");

type Props = Readonly<{
  currentProjectVersion: number;
  onExport: () => void;
  snapshot: BlueprintSnapshot;
}>;

export function BrandBlueprint({ currentProjectVersion, onExport, snapshot }: Props) {
  const stale = snapshot.project_version < currentProjectVersion;
  return <div className="blueprint-reading-view">
    <div className="blueprint-actions" data-print-hidden="true">
      <Link className="blueprint-back" href={`/projects/${encodeURIComponent(snapshot.project_id)}`}><GitBranch aria-hidden="true" />Back to constellation</Link>
      <button onClick={onExport} type="button"><Download aria-hidden="true" />Export PDF</button>
    </div>
    {stale && <p className="blueprint-stale" data-print-hidden="true" role="status"><History aria-hidden="true" />Current graph version {currentProjectVersion} is newer than this immutable snapshot. Create a new snapshot to publish current decisions.</p>}
    <article className="blueprint-document" data-blueprint-document="true">
      <header className="blueprint-cover">
        <p className="blueprint-kicker">Starter Brand Blueprint</p>
        <h1>{snapshot.project_title}</h1>
        <p className="blueprint-deck">A traceable foundation for making brand decisions with clarity.</p>
        <dl>
          <div><dt>Edition</dt><dd>Snapshot {sequence(snapshot.sequence)}</dd></div>
          <div><dt>Source state</dt><dd>Graph version {snapshot.project_version}</dd></div>
          <div><dt>Published</dt><dd><time dateTime={snapshot.created_at}>{date(snapshot.created_at)}</time></dd></div>
        </dl>
      </header>
      {snapshot.readiness_warnings.length > 0 && <aside className="blueprint-readiness" role="alert">
        <strong>Early Blueprint</strong>
        <p>Published before every section is ready. Assumptions and open risks remain explicit.</p>
        <ul>{snapshot.readiness_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </aside>}
      <div className="blueprint-sections">{SECTIONS.map(([slug, title, description]) => <BlueprintSection description={description} key={slug} projectId={snapshot.project_id} section={snapshot.sections[slug]} title={title} />)}</div>
      <footer className="blueprint-footer"><span>{snapshot.project_title}</span><span>Snapshot {sequence(snapshot.sequence)} · Graph version {snapshot.project_version} · {date(snapshot.created_at)}</span></footer>
    </article>
  </div>;
}
