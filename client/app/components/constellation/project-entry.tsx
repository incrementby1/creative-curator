"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/auth-provider";
import { createProjectsApi } from "../../lib/projects-api";
import type { ProjectGraph } from "../../lib/project-types";
import { ConstellationEditor } from "./constellation-editor";
import "./constellation.css";

export function ProjectEntry({ projectId }: { projectId: string }) {
  const { client, ready, user } = useAuth();
  const api = useMemo(() => createProjectsApi(client ?? undefined), [client]);
  const [graph, setGraph] = useState<ProjectGraph | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready || !client || !user) return;
    let active = true;
    void api.loadProject(projectId).then((loaded) => { if (active) setGraph(loaded); }).catch(() => { if (active) setError("Project could not be loaded. Check your connection and try again."); });
    return () => { active = false; };
  }, [api, attempt, client, projectId, ready, user]);
  if (error) return <div className="constellation-error" role="alert"><p>{error}</p><button onClick={() => { setError(""); setAttempt((value) => value + 1); }} type="button">Retry project</button></div>;
  if (!graph) return <p className="constellation-loading" role="status">Loading Brand Constellation…</p>;
  return <ConstellationEditor initial={graph} />;
}
