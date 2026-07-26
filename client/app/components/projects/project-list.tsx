"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/auth-provider";
import { createProjectsApi } from "../../lib/projects-api";
import type { Project, ProjectSummary } from "../../lib/project-types";
import styles from "../../styles/projects.module.css";

type ProjectRow = Readonly<{
  project: Project;
  summary: ProjectSummary | null;
}>;

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}`;
}

export function ProjectList() {
  const { client, ready } = useAuth();
  const [rows, setRows] = useState<readonly ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!ready || !client) return;
    let active = true;
    const api = createProjectsApi(client);
    void api.listProjects().then(async (projects) => {
      const details = await Promise.all(projects.map(async (project) => {
        try {
          return { project, summary: await api.getProjectSummary(project.id) };
        } catch {
          return { project, summary: null };
        }
      }));
      if (active) setRows(details);
    }).catch(() => {
      if (active) setError("Projects could not be loaded. Try again.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [client, ready]);

  async function retryStatus(projectId: string) {
    if (!client) return;
    setRetrying((current) => new Set(current).add(projectId));
    try {
      const summary = await createProjectsApi(client).getProjectSummary(projectId);
      setRows((current) => current.map((row) => row.project.id === projectId ? { ...row, summary } : row));
    } catch {
      setRows((current) => current.map((row) => row.project.id === projectId ? { ...row, summary: null } : row));
    } finally {
      setRetrying((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
    }
  }

  if (loading) return <p className={styles.status} role="status">Loading projects…</p>;
  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!rows.length) return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <p className={styles.index}>Start here</p>
      <h2 id="empty-title">No brand projects yet</h2>
      <p>Capture what you know. Leave uncertain answers open. Your first constellation grows from there.</p>
      <Link className={styles.primaryAction} href="/projects/new">Create project</Link>
    </section>
  );

  return (
    <div className={styles.tableWrap}>
      <table className={styles.projectTable}>
        <thead><tr><th>Project</th><th>Blueprint</th><th>Challenges</th><th><span className={styles.visuallyHidden}>Action</span></th></tr></thead>
        <tbody>{rows.map(({ project, summary }) => (
          <tr key={project.id}>
            <th scope="row"><strong>{project.title}</strong><time dateTime={project.updated_at}>{relativeTime(project.updated_at)}</time></th>
            {summary ? <><td>{summary.blueprint_ready ? "Ready" : "Not ready"}</td><td>{summary.unresolved_challenge_count} unresolved</td></> : <td colSpan={2}><span>Status unavailable</span><button className={styles.retryStatus} disabled={retrying.has(project.id)} onClick={() => void retryStatus(project.id)} type="button">{retrying.has(project.id) ? "Retrying…" : "Retry status"}</button></td>}
            <td><Link aria-label={`Open ${project.title}`} href={`/projects/${project.id}`}>Open</Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
