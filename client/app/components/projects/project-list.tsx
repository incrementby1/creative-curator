"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/auth-provider";
import { createProjectsApi } from "../../lib/projects-api";
import type { Project } from "../../lib/project-types";
import styles from "../../styles/projects.module.css";

type ProjectRow = Readonly<{
  project: Project;
  ready: boolean;
  unresolvedChallenges: number;
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

  useEffect(() => {
    if (!ready || !client) return;
    let active = true;
    const api = createProjectsApi(client);
    void api.listProjects().then(async (projects) => {
      const details = await Promise.all(projects.map(async (project) => {
        try {
          const [graph, readiness] = await Promise.all([
            api.loadProject(project.id),
            api.getBlueprintReadiness(project.id),
          ]);
          return {
            project,
            ready: readiness.ready,
            unresolvedChallenges: graph.nodes.filter((node) => node.node_type === "challenge" && node.state !== "trash").length,
          };
        } catch {
          return { project, ready: false, unresolvedChallenges: 0 };
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
        <tbody>{rows.map(({ project, ready: blueprintReady, unresolvedChallenges }) => (
          <tr key={project.id}>
            <th scope="row"><strong>{project.title}</strong><time dateTime={project.updated_at}>{relativeTime(project.updated_at)}</time></th>
            <td>{blueprintReady ? "Ready" : "Not ready"}</td>
            <td>{unresolvedChallenges} unresolved</td>
            <td><Link aria-label={`Open ${project.title}`} href={`/projects/${project.id}`}>Open</Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
