"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/auth-provider";
import { createProjectsApi } from "../../lib/projects-api";
import type { NodeType, Project } from "../../lib/project-types";
import styles from "../../styles/projects.module.css";

type DiagnosticDraft = Readonly<{
  title: string; intent: string; facts: string; assumptions: string;
  constraints: string; outcomes: string; questions: string;
}>;
type DraftField = keyof DiagnosticDraft;
type SeedField = Exclude<DraftField, "title">;
type Seed = Readonly<{ field: SeedField; node_type: NodeType; title: string; content: string }>;

const EMPTY: DiagnosticDraft = { title: "", intent: "", facts: "", assumptions: "", constraints: "", outcomes: "", questions: "" };
const PROVENANCE = "Adaptive diagnostic — user supplied";
const MAX_DIAGNOSTIC_SEEDS = 12;
const MAX_DIAGNOSTIC_ITEM_LENGTH = 500;
const split = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

function seeds(draft: DiagnosticDraft): readonly Seed[] {
  const result: Seed[] = [];
  if (draft.intent.trim()) result.push({ field: "intent", node_type: "idea", title: "Project intent", content: draft.intent.trim() });
  split(draft.facts).forEach((content) => result.push({ field: "facts", node_type: "evidence", title: "Known fact", content }));
  split(draft.assumptions).forEach((content) => result.push({ field: "assumptions", node_type: "assumption", title: "Assumption", content }));
  split(draft.constraints).forEach((content) => result.push({ field: "constraints", node_type: "evidence", title: "Constraint", content }));
  split(draft.outcomes).forEach((content) => result.push({ field: "outcomes", node_type: "idea", title: "Desired outcome", content }));
  split(draft.questions).forEach((content) => result.push({ field: "questions", node_type: "assumption", title: "Open question", content }));
  return result;
}

function remainingDraft(title: string, remaining: readonly Seed[]): DiagnosticDraft {
  const values: Record<SeedField, string[]> = { intent: [], facts: [], assumptions: [], constraints: [], outcomes: [], questions: [] };
  remaining.forEach((seed) => values[seed.field].push(seed.content));
  return { title, intent: values.intent.join("\n"), facts: values.facts.join("\n"), assumptions: values.assumptions.join("\n"), constraints: values.constraints.join("\n"), outcomes: values.outcomes.join("\n"), questions: values.questions.join("\n") };
}

function diagnosticValidationError(items: readonly Seed[]): string {
  if (items.length > MAX_DIAGNOSTIC_SEEDS) {
    return `Keep the diagnostic to ${MAX_DIAGNOSTIC_SEEDS} entries or fewer. Combine related points before creating the project.`;
  }
  if (items.some((item) => item.content.length > MAX_DIAGNOSTIC_ITEM_LENGTH)) {
    return `Keep each diagnostic entry to ${MAX_DIAGNOSTIC_ITEM_LENGTH} characters or fewer.`;
  }
  return "";
}

export function ProjectDiagnostic() {
  const router = useRouter();
  const { client, ready, user } = useAuth();
  const [draft, setDraft] = useState<DiagnosticDraft>(EMPTY);
  const [created, setCreated] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const storageKey = useMemo(() => user ? `creative-curator:diagnostic:${user.id}:new` : "", [user]);

  useEffect(() => {
    if (!storageKey) return;
    let active = true;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const restored = { ...EMPTY, ...(JSON.parse(saved) as Partial<DiagnosticDraft>) };
        queueMicrotask(() => { if (active) setDraft(restored); });
      }
    } catch { /* Ignore invalid local drafts. */ }
    return () => { active = false; };
  }, [storageKey]);

  function persist(value = draft, projectId?: string) {
    if (!user) return;
    localStorage.setItem(`creative-curator:diagnostic:${user.id}:${projectId ?? "new"}`, JSON.stringify(value));
  }

  function update(field: DraftField, value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    persist(next);
  }

  async function submit(skipDiagnostic: boolean) {
    if (!client || !user || !draft.title.trim()) {
      setError(draft.title.trim() ? "Project service is not ready. Try again." : "Enter a project name.");
      return;
    }
    const diagnosticSeeds = skipDiagnostic ? [] : seeds(draft);
    const validationError = diagnosticValidationError(diagnosticSeeds);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError("");
    const api = createProjectsApi(client);
    let project: Project | null = null;
    let unsent = [...diagnosticSeeds];
    try {
      project = await api.createProject(draft.title.trim());
      setCreated(project);
      localStorage.setItem(`creative-curator:current-project:${user.id}`, JSON.stringify({ id: project.id, title: project.title }));
      window.dispatchEvent(new Event("creative-curator:current-project"));
      if (!skipDiagnostic) {
        let version = project.version;
        for (const seed of unsent) {
          await api.createNode(project.id, {
            node_type: seed.node_type,
            title: seed.title,
            content: seed.content,
            created_by: "user",
            provenance: PROVENANCE,
            tags: [],
            expected_project_version: version,
          });
          version += 1;
          unsent = unsent.slice(1);
        }
      }
      localStorage.removeItem(storageKey);
    } catch {
      if (project) {
        const recoveryDraft = remainingDraft(draft.title, unsent);
        persist(recoveryDraft, project.id);
        persist(recoveryDraft);
        setError("Project created, but some diagnostic notes were not saved. Your draft remains on this device.");
      } else setError("Project could not be created. Your draft remains on this device; try again.");
    } finally {
      setBusy(false);
    }
  }

  if (created && !error) return (
    <section className={styles.created}>
      <p className={styles.index}>Ready to explore</p>
      <h1>Project created</h1>
      <p>{created.title} is ready. Continue into its Brand Constellation when canvas tools arrive.</p>
      <div className={styles.actions}><Link className={styles.primaryAction} href={`/projects/${created.id}`}>Open {created.title}</Link><Link className={styles.secondaryAction} href="/projects">Back to projects</Link></div>
    </section>
  );

  return (
    <form className={styles.diagnostic} onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
      <div className={styles.diagnosticHeader}><div><p className={styles.index}>Adaptive diagnostic</p><h1>Start with what is true today</h1></div><p>Skip anything uncertain. Empty fields stay empty—Creative Curator never invents your answers.</p></div>
      {error && <div className={styles.recovery} role="alert"><p>{error}</p>{created && <Link href={`/projects/${created.id}`}>Open {created.title}</Link>}</div>}
      <Field label="Project name" name="title" value={draft.title} onChange={update} required hint="A working name is enough." />
      <Field label="What are you building?" name="intent" value={draft.intent} onChange={update} hint="Describe the offer, organization, or idea in plain language." />
      <div className={styles.fieldGrid}>
        <Field label="Known facts" name="facts" value={draft.facts} onChange={update} hint="One verified fact per line." />
        <Field label="Assumptions" name="assumptions" value={draft.assumptions} onChange={update} hint="One belief to test per line." />
        <Field label="Constraints" name="constraints" value={draft.constraints} onChange={update} hint="Timing, budget, market, or operating limits." />
        <Field label="Desired outcomes" name="outcomes" value={draft.outcomes} onChange={update} hint="One useful change per line." />
      </div>
      <Field label="Open questions" name="questions" value={draft.questions} onChange={update} hint="Questions worth carrying into the constellation." />
      <div className={styles.formActions}>
        <button className={styles.primaryButton} disabled={busy || !ready} type="submit">{busy ? "Creating…" : "Create project"}</button>
        <button className={styles.secondaryButton} disabled={busy || !draft.title.trim()} onClick={() => void submit(true)} type="button">Skip diagnostic</button>
        <button className={styles.textButton} disabled={busy} onClick={() => { persist(); router.push("/projects"); }} type="button">Save and return</button>
      </div>
    </form>
  );
}

function Field({ label, name, value, onChange, hint, required = false }: { label: string; name: DraftField; value: string; onChange: (name: DraftField, value: string) => void; hint: string; required?: boolean }) {
  const id = `diagnostic-${name}`;
  const hintId = `${id}-hint`;
  return <label className={styles.field} htmlFor={id}><span>{label}</span><small id={hintId}>{hint}</small>{name === "title" ? <input aria-describedby={hintId} id={id} maxLength={160} onChange={(event) => onChange(name, event.target.value)} required={required} value={value} /> : <textarea aria-describedby={hintId} id={id} maxLength={4000} onChange={(event) => onChange(name, event.target.value)} rows={4} value={value} />}</label>;
}
