import Link from "next/link";
import type { BlueprintSection as BlueprintSectionRecord } from "../../lib/project-types";

type Props = Readonly<{
  description: string;
  projectId: string;
  section: BlueprintSectionRecord;
  title: string;
}>;

const TYPE_LABELS: Readonly<Record<string, string>> = {
  assumption: "Assumption", challenge: "Unresolved challenge", decision: "Approved direction",
  evidence: "Evidence", idea: "Working idea", output: "Output",
};

export function BlueprintSection({ description, projectId, section, title }: Props) {
  return <section className="blueprint-section" data-ready={section.ready}>
    <header>
      <div><p className="blueprint-section__index" aria-hidden="true">{section.ready ? "Ready" : "In progress"}</p><h2>{title}</h2></div>
      <p>{description}</p>
    </header>
    {!section.ready && <p className="blueprint-section__warning">Section carries unresolved inputs or still needs an approved decision.</p>}
    {section.entries.length ? <div className="blueprint-section__entries">{section.entries.map((entry) => {
      const id = entry.id ?? ""; const type = entry.type ?? "idea";
      return <article aria-label={entry.title || "Untitled source"} className="blueprint-entry" data-entry-type={type} key={`${id}:${entry.title}`}>
        <div className="blueprint-entry__meta"><span>{TYPE_LABELS[type] ?? type}</span>{id && <Link aria-label="Open source node" href={`/projects/${encodeURIComponent(projectId)}?node=${encodeURIComponent(id)}`}><span>Source </span><code data-source-id={id}>{id}</code><span className="blueprint-entry__source-action"> · Open node</span></Link>}</div>
        <h3>{entry.title || "Untitled source"}</h3>
        {entry.content && <p>{entry.content}</p>}
        <details><summary>Rationale</summary><p>{entry.rationale || "No rationale was recorded for this source."}</p></details>
      </article>;
    })}</div> : <p className="blueprint-section__empty">No canonical source material in this snapshot.</p>}
  </section>;
}
