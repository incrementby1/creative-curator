import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthClient } from "./auth";
import { TEST_AUTH_COOKIE } from "./auth";
import { ApiClientError, authorizedJson } from "./api-client";
import { creativeApi } from "./creative-api";
import { createProjectsApi, MAX_MEDIA_UPLOAD_BYTES, projectMediaUrl, replaceMediaHandle } from "./projects-api";
import { settingsApi } from "./settings-api";

const auth: AuthClient = {
  getAccessToken: vi.fn(async () => "token"), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
  subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
};

afterEach(() => vi.restoreAllMocks());

describe("projects API", () => {
  it("maps routes and retries one 401 through existing auth behavior", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "no" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    expect(await createProjectsApi(auth).listProjects()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("maps safe typed errors without exposing raw graph content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      detail: { code: "version_conflict", graph: "SECRET GRAPH" },
    }), { status: 409 }));
    await expect(createProjectsApi(auth).loadProject("p")).rejects.toMatchObject({
      status: 409, code: "version_conflict", message: "Project changed elsewhere. Reload and compare before retrying.",
    } satisfies Partial<ApiClientError>);
  });

  it("maps owner-safe 404 without rendering arbitrary detail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ detail: "SECRET GRAPH" }), { status: 404 }));
    await expect(createProjectsApi(auth).loadProject("p")).rejects.toMatchObject({
      status: 404, code: "project_not_found", message: "Project was not found or is unavailable.",
    });
  });

  it("keeps shared, Settings, and Creative 404 errors generic and content-safe", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ detail: "SECRET GRAPH" }), { status: 404 }));
    await expect(authorizedJson("/generic", {}, auth)).rejects.toMatchObject({
      status: 404, code: "not_found", message: "Requested resource was not found.",
    });
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "test");
    document.cookie = `${TEST_AUTH_COOKIE}=test-user:quality; Path=/`;
    await expect(settingsApi.catalog()).rejects.toMatchObject({ code: "not_found", message: "Requested resource was not found." });
    await expect(creativeApi.start({ brand_name: "Brand", description: "Description", goal: null, reference: null }))
      .rejects.toMatchObject({ code: "not_found", message: "Requested resource was not found." });
  });

  it.each([
    [413, "media_too_large", "Media must be no larger than 5 MiB."],
    [415, "invalid_media_type", "Use a PNG, JPEG, or WebP image."],
    [503, "project_store_unavailable", "Project service is unavailable. Your work is unchanged; try again."],
  ] as const)("maps safe status %i/code %s", async (status, code, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: { code, raw: "SECRET" } }), { status }));
    await expect(createProjectsApi(auth).loadProject("p")).rejects.toMatchObject({ status, code, message });
  });

  it("bounds uploads and resolves only authorized same-origin media URLs", async () => {
    const api = createProjectsApi(auth);
    await expect(api.uploadMedia("p", new File([new Uint8Array(MAX_MEDIA_UPLOAD_BYTES + 1)], "x.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "media_too_large" });
    expect(projectMediaUrl("p a", "m/b")).toBe("/api/projects/p%20a/media/m%2Fb");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "m", upload_claim: "claim" }), { status: 201 }));
    const file = new File([new Uint8Array([1, 2, 3])], "brand.png", { type: "image/png" });
    await api.uploadMedia("p", file);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/media", expect.objectContaining({
      method: "POST", body: file, headers: expect.any(Headers),
    }));
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("X-Filename")).toBe("brand.png");
    expect(headers.get("Content-Type")).toBe("image/png");
  });

  it("bounds media responses, retries one 401, returns disposable URL, and revokes replacement", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png", "Content-Length": "3" } }));
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const handle = await createProjectsApi(auth).resolveMediaUrl("p", "m");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledOnce();
    expect(handle.url).toBe("blob:owned");
    expect(replaceMediaHandle(handle, null)).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:owned");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Length": String(MAX_MEDIA_UPLOAD_BYTES + 1) } }));
    await expect(createProjectsApi(auth).loadMedia("p", "m")).rejects.toMatchObject({ code: "media_too_large" });
  });

  it("uses shared final-401 login recovery", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    await expect(createProjectsApi(auth).loadMedia("p", "m")).rejects.toMatchObject({ code: "authentication_required" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps core mutation routes and JSON bodies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: 3 }), { status: 200 }));
    await createProjectsApi(auth).saveLayout("p", 3, { n: [1, 2] }, { n: [240, 144] });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/layout", expect.objectContaining({ method: "PUT", body: JSON.stringify({
      expected_layout_version: 3, positions: { n: [1, 2] }, dimensions: { n: [240, 144] },
    }) }));
  });

  it("maps each API family to exact paths and payloads", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
      calls.push([String(path), init]);
      return init?.method === "DELETE" || String(path).endsWith("/theme") ? new Response(null, { status: 204 }) : new Response(JSON.stringify([]), { status: 200 });
    });
    const api = createProjectsApi(auth);
    await api.listProjects(); await api.listProjectSummaries(); await api.createProject("Title"); await api.loadProject("p/x");
    await api.createNode("p", { node_type: "idea", title: "Idea", content: "Content", created_by: "user", provenance: null, tags: ["tag"], expected_project_version: 1 });
    await api.updateNode("p", "n", { node_type: "decision", title: "Decision", content: "Content", state: "working", created_by: "user", provenance: null, tags: [], expected_node_version: 1, expected_project_version: 2 });
    await api.listNodeRevisions("p", "n"); await api.trashNode("p", "n", 2); await api.restoreNode("p", "n", 3); await api.approveDecision("p", "n", 4);
    await api.createEdge("p", { source_node_id: "n", target_node_id: "m", edge_type: "supports", label: null, expected_project_version: 2 });
    await api.updateEdge("p", "e", { edge_type: "contradicts", label: "because", expected_edge_version: 1, expected_project_version: 3 });
    await api.deleteEdge("p", "e", 2, 5); await api.saveAnnotations("p", 1, []); await api.deleteMedia("p", "m");
    await api.analyze("p", "n", "challenge", 5, "request-1"); await api.listProposals("p"); await api.acceptProposal("p", "q", 5);
    await api.resolveChallenge("p", "n", "overridden", "tradeoff", 5);
    await api.getBlueprintReadiness("p"); await api.createBlueprintSnapshot("p", 5); await api.listBlueprintSnapshots("p"); await api.getBlueprintSnapshot("p", "s");
    await api.setGlobalTheme("paper"); await api.setProjectTheme("p", null);
    expect(calls.map(([path]) => path)).toEqual([
      "/api/projects?limit=50", "/api/projects/summaries?limit=50", "/api/projects", "/api/projects/p%2Fx", "/api/projects/p/nodes", "/api/projects/p/nodes/n", "/api/projects/p/revisions/n",
      "/api/projects/p/nodes/n/trash", "/api/projects/p/nodes/n/restore", "/api/projects/p/nodes/n/approve",
      "/api/projects/p/edges", "/api/projects/p/edges/e", "/api/projects/p/edges/e", "/api/projects/p/annotations", "/api/projects/p/media/m", "/api/projects/p/analysis",
      "/api/projects/p/proposals", "/api/projects/p/proposals/q/accept", "/api/projects/p/challenges/n/resolve",
      "/api/projects/p/blueprint/readiness", "/api/projects/p/blueprints", "/api/projects/p/blueprints",
      "/api/projects/p/blueprints/s", "/api/users/me/theme", "/api/projects/p/theme",
    ]);
    expect(calls[4][1]?.body).toBe(JSON.stringify({ node_type: "idea", title: "Idea", content: "Content", created_by: "user", provenance: null, tags: ["tag"], expected_project_version: 1 }));
    expect(calls[15][1]?.body).toBe(JSON.stringify({ selected_node_id: "n", analysis_type: "challenge", expected_project_version: 5, idempotency_key: "request-1" }));
  });
});
