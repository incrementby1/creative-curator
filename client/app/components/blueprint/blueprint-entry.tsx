"use client";

import { useAuth } from "../auth/auth-provider";
import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../../lib/api-client";
import { derivePrintAccent, deriveProjectTheme } from "../../lib/project-theme";
import { createProjectsApi } from "../../lib/projects-api";
import type { BlueprintReadiness, BlueprintSnapshot, ProjectGraph } from "../../lib/project-types";
import { BrandBlueprint } from "./brand-blueprint";

export function BlueprintEntry({ projectId }: { projectId: string }) {
  const { client, ready, user } = useAuth();
  const api = useMemo(() => createProjectsApi(client ?? undefined), [client]);
  const [graph, setGraph] = useState<ProjectGraph | null>(null);
  const [readiness, setReadiness] = useState<BlueprintReadiness | null>(null);
  const [snapshots, setSnapshots] = useState<readonly BlueprintSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0);
  const [failedVersion, setFailedVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!ready || !client || !user) return;
    let active = true;
    void Promise.all([api.loadProject(projectId), api.getBlueprintReadiness(projectId), api.listBlueprintSnapshots(projectId)])
      .then(([loadedGraph, loadedReadiness, loadedSnapshots]) => {
        if (!active) return;
        const ordered = [...loadedSnapshots].sort((a, b) => b.sequence - a.sequence || b.id.localeCompare(a.id));
        setGraph(loadedGraph); setReadiness(loadedReadiness); setSnapshots(ordered);
        setSelectedId((current) => current && ordered.some((item) => item.id === current) ? current : ordered[0]?.id ?? null);
      }).catch(() => { if (active) setError("Blueprint could not be loaded. Your project is unchanged; try again."); });
    return () => { active = false; };
  }, [api, attempt, client, projectId, ready, user]);

  const snapshot = snapshots.find((item) => item.id === selectedId) ?? null;
  const theme = graph ? deriveProjectTheme(graph.theme, graph.nodes) : null;
  const style = theme ? { "--project-accent": theme.tokens.accent, "--project-accent-text": theme.tokens.accentText,
    "--print-project-accent": derivePrintAccent(theme.tokens.accent) } as React.CSSProperties : undefined;

  async function createSnapshot(capturedVersion = graph?.project.version) {
    if (!graph) return;
    if (capturedVersion === undefined) return;
    setBusy(true); setError("");
    try {
      const created = await api.createBlueprintSnapshot(projectId, capturedVersion);
      const [freshGraph, freshReadiness, freshSnapshots] = await Promise.all([api.loadProject(projectId), api.getBlueprintReadiness(projectId), api.listBlueprintSnapshots(projectId)]);
      const ordered = [...freshSnapshots].sort((a, b) => b.sequence - a.sequence || b.id.localeCompare(a.id));
      setGraph(freshGraph); setReadiness(freshReadiness); setSnapshots(ordered); setSelectedId(created.id); setFailedVersion(null);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === "version_conflict") {
        setFailedVersion(capturedVersion);
        try {
          const [freshGraph, freshReadiness, freshSnapshots] = await Promise.all([api.loadProject(projectId), api.getBlueprintReadiness(projectId), api.listBlueprintSnapshots(projectId)]);
          const ordered = [...freshSnapshots].sort((a, b) => b.sequence - a.sequence || b.id.localeCompare(a.id));
          setGraph(freshGraph); setReadiness(freshReadiness); setSnapshots(ordered);
          setSelectedId((current) => current && ordered.some((item) => item.id === current) ? current : ordered[0]?.id ?? null);
          setError(`Snapshot retry remains bound to graph version ${capturedVersion}; current graph is version ${freshGraph.project.version}. Cancel retry before creating from current graph.`);
        } catch { setError("Graph changed before this snapshot could be created, and current version could not be reloaded. Existing history is unchanged; retry loading Blueprint."); }
      } else { setFailedVersion(capturedVersion); setError(`Snapshot was not created. Retry remains bound to graph version ${capturedVersion}; existing history is unchanged.`); }
    } finally { setBusy(false); }
  }

  if (error && !graph) return <div className="blueprint-load-error" data-print-hidden="true" role="alert"><p>{error}</p><button onClick={() => { setError(""); setAttempt((value) => value + 1); }} type="button">Retry Blueprint</button></div>;
  if (!graph || !readiness) return <p className="blueprint-loading" role="status">Loading Blueprint…</p>;
  return <main className="blueprint-workspace workbench-motion" data-theme={graph.theme} style={style}>
    <header className="blueprint-toolbar" data-print-hidden="true">
      <div><p>Publication workspace</p><h1>Starter Brand Blueprint</h1><span>{readiness.ready ? "Ready to publish" : `${readiness.warnings.length} readiness warnings`}</span></div>
      <button disabled={busy || failedVersion !== null} onClick={() => void createSnapshot()} type="button">{busy ? "Creating snapshot…" : "Create snapshot"}</button>
    </header>
    {error && <div className="blueprint-inline-error" data-print-hidden="true" role="alert"><p>{error}</p>{failedVersion !== null && <div><button disabled={busy} onClick={() => void createSnapshot(failedVersion)} type="button">Retry version {failedVersion}</button><button disabled={busy} onClick={() => { setFailedVersion(null); setError(""); }} type="button">Cancel retry</button></div>}</div>}
    {snapshots.length > 0 && <nav aria-label="Blueprint snapshot history" className="blueprint-history" data-print-hidden="true">
      <span>Immutable history</span>{snapshots.map((item) => <button aria-current={item.id === selectedId ? "page" : undefined} key={item.id} onClick={() => setSelectedId(item.id)} type="button">Snapshot {sequenceLabel(item.sequence)} <small>v{item.project_version} · {shortDate(item.created_at)}</small></button>)}
    </nav>}
    {snapshot ? <BrandBlueprint currentProjectVersion={graph.project.version} onExport={() => window.print()} snapshot={snapshot} /> : <section className="blueprint-empty"><p>Blueprint has no published edition yet.</p><h2>Create an immutable snapshot of current semantic graph</h2><p>Use Create snapshot above. Snapshot uses server readiness and canonical section compilation. Canvas arrangement, drawings, and media stay outside it.</p></section>}
  </main>;
}

const sequenceLabel = (value: number) => value.toString().padStart(2, "0");
const shortDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
