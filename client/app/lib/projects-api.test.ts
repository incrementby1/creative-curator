import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthClient } from "./auth";
import { ApiClientError } from "./api-client";
import { createProjectsApi, MAX_MEDIA_UPLOAD_BYTES, projectMediaUrl } from "./projects-api";

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

  it("bounds uploads and resolves only authorized same-origin media URLs", async () => {
    const api = createProjectsApi(auth);
    await expect(api.uploadMedia("p", new File([new Uint8Array(MAX_MEDIA_UPLOAD_BYTES + 1)], "x.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "media_too_large" });
    expect(projectMediaUrl("p a", "m/b")).toBe("/api/projects/p%20a/media/m%2Fb");
  });

  it("maps core mutation routes and JSON bodies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: 3 }), { status: 200 }));
    await createProjectsApi(auth).saveLayout("p", { n: [1, 2] });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/layout", expect.objectContaining({ method: "PUT", body: JSON.stringify({ positions: { n: [1, 2] } }) }));
  });
});
