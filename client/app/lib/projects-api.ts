import { ApiClientError, authorizedJson, authorizedResponse } from "./api-client";
import type { AuthClient } from "./auth";
import type {
  AcceptedProposal, BlueprintReadiness, BlueprintSnapshot, CanvasAnnotation, ChallengeResolution,
  EdgeCreateInput, EdgeUpdateInput, GraphEdge, GraphNode, ListedProposal, NodeCreateInput,
  NodeRevision, NodeUpdateInput, Project, ProjectGraph, ProjectListSummary, ProjectSummary, ProposalWithCandidate, ThemeChoice,
  UploadedCanvasMedia,
} from "./project-types";

export const MAX_MEDIA_UPLOAD_BYTES = 5 * 1024 * 1024;
const json = (body: object): string => JSON.stringify(body);
const segment = (value: string): string => encodeURIComponent(value);
const projectPath = (projectId: string): string => `/api/projects/${segment(projectId)}`;

export function projectMediaUrl(projectId: string, mediaId: string): string {
  return `${projectPath(projectId)}/media/${segment(mediaId)}`;
}

async function authorizedMedia(path: string, suppliedClient?: AuthClient): Promise<Blob> {
  const response = await authorizedResponse(path, {}, suppliedClient, "project");
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_MEDIA_UPLOAD_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiClientError(413, "media_too_large", "Media must be no larger than 5 MiB.");
  }
  if (!response.body) return new Blob([], { type: response.headers.get("Content-Type") ?? "application/octet-stream" });
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MEDIA_UPLOAD_BYTES) throw new ApiClientError(413, "media_too_large", "Media must be no larger than 5 MiB.");
      chunks.push(value.slice().buffer as ArrayBuffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const blob = new Blob(chunks, { type: response.headers.get("Content-Type") ?? "application/octet-stream" });
  if (blob.size > MAX_MEDIA_UPLOAD_BYTES) throw new ApiClientError(413, "media_too_large", "Media must be no larger than 5 MiB.");
  return blob;
}

export type MediaObjectUrl = Readonly<{ url: string; revoke: () => void }>;
function mediaObjectUrl(blob: Blob): MediaObjectUrl {
  const url = URL.createObjectURL(blob);
  let active = true;
  return { url, revoke: () => { if (active) { active = false; URL.revokeObjectURL(url); } } };
}
export function replaceMediaHandle(current: MediaObjectUrl | null, replacement: MediaObjectUrl | null): MediaObjectUrl | null {
  if (current !== replacement) current?.revoke();
  return replacement;
}
export function revokeMediaHandle(handle: MediaObjectUrl | null): void { handle?.revoke(); }

export function createProjectsApi(authClient?: AuthClient) {
  const request = <T>(path: string, init?: RequestInit) => authorizedJson<T>(path, init, authClient, "project");
  return {
    listProjects: (limit = 50) => request<Project[]>(`/api/projects?limit=${limit}`),
    listProjectSummaries: (limit = 50) => request<ProjectListSummary[]>(`/api/projects/summaries?limit=${limit}`),
    createProject: (title: string) => request<Project>("/api/projects", { method: "POST", body: json({ title }) }),
    loadProject: (projectId: string) => request<ProjectGraph>(projectPath(projectId)),
    getProjectSummary: (projectId: string) => request<ProjectSummary>(`${projectPath(projectId)}/summary`),

    createNode: (projectId: string, input: NodeCreateInput) => request<GraphNode>(`${projectPath(projectId)}/nodes`, { method: "POST", body: json(input) }),
    updateNode: (projectId: string, nodeId: string, input: NodeUpdateInput) => request<GraphNode>(`${projectPath(projectId)}/nodes/${segment(nodeId)}`, { method: "PATCH", body: json(input) }),
    trashNode: (projectId: string, nodeId: string, expectedNodeVersion: number) => request<GraphNode>(`${projectPath(projectId)}/nodes/${segment(nodeId)}/trash`, { method: "POST", body: json({ expected_node_version: expectedNodeVersion }) }),
    restoreNode: (projectId: string, nodeId: string, expectedNodeVersion: number) => request<GraphNode>(`${projectPath(projectId)}/nodes/${segment(nodeId)}/restore`, { method: "POST", body: json({ expected_node_version: expectedNodeVersion }) }),
    approveDecision: (projectId: string, nodeId: string, expectedNodeVersion: number) => request<GraphNode>(`${projectPath(projectId)}/nodes/${segment(nodeId)}/approve`, { method: "POST", body: json({ expected_node_version: expectedNodeVersion }) }),
    listNodeRevisions: (projectId: string, nodeId: string) => request<NodeRevision[]>(`${projectPath(projectId)}/revisions/${segment(nodeId)}`),

    createEdge: (projectId: string, input: EdgeCreateInput) => request<GraphEdge>(`${projectPath(projectId)}/edges`, { method: "POST", body: json(input) }),
    updateEdge: (projectId: string, edgeId: string, input: EdgeUpdateInput) => request<GraphEdge>(`${projectPath(projectId)}/edges/${segment(edgeId)}`, { method: "PATCH", body: json(input) }),
    deleteEdge: (projectId: string, edgeId: string, expectedEdgeVersion: number, expectedProjectVersion: number) => request<void>(`${projectPath(projectId)}/edges/${segment(edgeId)}`, { method: "DELETE", body: json({ expected_edge_version: expectedEdgeVersion, expected_project_version: expectedProjectVersion }) }),

    saveLayout: (projectId: string, positions: Readonly<Record<string, readonly [number, number]>>) => request<{ version: number }>(`${projectPath(projectId)}/layout`, { method: "PUT", body: json({ positions }) }),
    saveAnnotations: (projectId: string, expectedAnnotationVersion: number, annotations: readonly CanvasAnnotation[], discardMediaOnFailure: readonly Readonly<{ media_id: string; upload_claim: string }>[] = []) => request<{ version: number }>(`${projectPath(projectId)}/annotations`, { method: "PUT", body: json({ expected_annotation_version: expectedAnnotationVersion, annotations, discard_media_on_failure: discardMediaOnFailure }) }),

    uploadMedia: async (projectId: string, file: File) => {
      if (!file.size || file.size > MAX_MEDIA_UPLOAD_BYTES) throw new ApiClientError(413, "media_too_large", "Media must be no larger than 5 MiB.");
      return request<UploadedCanvasMedia>(`${projectPath(projectId)}/media`, { method: "POST", headers: { "Content-Type": file.type, "X-Filename": file.name }, body: file });
    },
    deleteMedia: (projectId: string, mediaId: string) => request<void>(projectMediaUrl(projectId, mediaId), { method: "DELETE" }),
    loadMedia: async (projectId: string, mediaId: string) => {
      return authorizedMedia(projectMediaUrl(projectId, mediaId), authClient);
    },
    resolveMediaUrl: async (projectId: string, mediaId: string) => mediaObjectUrl(await authorizedMedia(projectMediaUrl(projectId, mediaId), authClient)),

    analyze: (projectId: string, selectedNodeId: string, analysisType: string, expectedProjectVersion: number, idempotencyKey: string) => request<ProposalWithCandidate>(`${projectPath(projectId)}/analysis`, { method: "POST", body: json({ selected_node_id: selectedNodeId, analysis_type: analysisType, expected_project_version: expectedProjectVersion, idempotency_key: idempotencyKey }) }),
    listProposals: (projectId: string) => request<ListedProposal[]>(`${projectPath(projectId)}/proposals`),
    acceptProposal: (projectId: string, proposalId: string, expectedProjectVersion: number) => request<AcceptedProposal>(`${projectPath(projectId)}/proposals/${segment(proposalId)}/accept`, { method: "POST", body: json({ expected_project_version: expectedProjectVersion }) }),
    resolveChallenge: (projectId: string, nodeId: string, state: "resolved" | "deferred" | "overridden", resolution: string, expectedProjectVersion: number) => request<ChallengeResolution>(`${projectPath(projectId)}/challenges/${segment(nodeId)}/resolve`, { method: "POST", body: json({ state, resolution, expected_project_version: expectedProjectVersion }) }),

    getBlueprintReadiness: (projectId: string) => request<BlueprintReadiness>(`${projectPath(projectId)}/blueprint/readiness`),
    createBlueprintSnapshot: (projectId: string, expectedProjectVersion: number) => request<BlueprintSnapshot>(`${projectPath(projectId)}/blueprints`, { method: "POST", body: json({ expected_project_version: expectedProjectVersion }) }),
    listBlueprintSnapshots: (projectId: string) => request<BlueprintSnapshot[]>(`${projectPath(projectId)}/blueprints`),
    getBlueprintSnapshot: (projectId: string, snapshotId: string) => request<BlueprintSnapshot>(`${projectPath(projectId)}/blueprints/${segment(snapshotId)}`),

    setGlobalTheme: (theme: ThemeChoice) => request<void>("/api/users/me/theme", { method: "PUT", body: json({ theme }) }),
    setProjectTheme: (projectId: string, theme: ThemeChoice | null) => request<void>(`${projectPath(projectId)}/theme`, { method: "PUT", body: json({ theme }) }),
  };
}

export const projectsApi = createProjectsApi();
