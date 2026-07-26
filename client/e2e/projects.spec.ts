import { expect, test } from "@playwright/test";
import { signInForTest, signOutForTest } from "./helpers/session";

test("projects routes are protected and root opens Projects", async ({ page }) => {
  await page.goto("/projects/new");
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects%2Fnew$/);
  await signInForTest(page);
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("legacy workspace remains available during rollout", async ({ page }) => {
  await signInForTest(page, "/studio", "legacy@example.com");
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByLabel("Brand name")).toBeVisible();
});

test("empty state offers one clear project action", async ({ page }) => {
  await signInForTest(page, "/projects", "empty@example.com");
  await expect(page.getByText("No brand projects yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create project" }).last()).toHaveAttribute("href", "/projects/new");
});

test("diagnostic creates typed user-supplied seeds", async ({ page }) => {
  await signInForTest(page, "/projects/new", "seeds@example.com");
  await page.getByLabel("Project name").fill("Northline");
  await page.getByLabel("What are you building?").fill("A calmer moving service");
  await page.getByLabel("Known facts").fill("Customers move under time pressure\nMost book on mobile");
  await page.getByLabel("Assumptions").fill("Calm language earns trust");
  await page.getByLabel("Constraints").fill("Launch in six weeks");
  await page.getByLabel("Desired outcomes").fill("Increase qualified bookings");
  await page.getByLabel("Open questions").fill("Which promise feels credible?");

  const nodeBodies: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (/\/api\/projects\/[^/]+\/nodes$/.test(new URL(request.url()).pathname)) {
      nodeBodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect.poll(() => nodeBodies.length, { timeout: 15_000 }).toBe(7);
  await expect(page.getByRole("heading", { name: "Project created" })).toBeVisible();

  expect(nodeBodies.map(({ node_type }) => node_type)).toEqual([
    "idea", "evidence", "evidence", "assumption", "evidence", "idea", "assumption",
  ]);
  expect(nodeBodies.every(({ created_by, provenance }) =>
    created_by === "user" && provenance === "Adaptive diagnostic — user supplied",
  )).toBe(true);
});

test("diagnostic saves and restores a draft without inventing answers", async ({ page }) => {
  await signInForTest(page, "/projects/new", "draft@example.com");
  await page.getByLabel("Project name").fill("Unfinished brand");
  await page.getByLabel("Known facts").fill("One verified fact");
  await page.getByRole("button", { name: "Save and return" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.getByLabel("No brand projects yet").getByRole("link", { name: "Create project" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Unfinished brand");
  await expect(page.getByLabel("Known facts")).toHaveValue("One verified fact");
  await expect(page.getByLabel("Assumptions")).toHaveValue("");
});

test("delayed auth hydration cannot overwrite diagnostic typing", async ({ page, context }) => {
  await signInForTest(page, "/projects/new", "hydrate@example.com");
  await page.getByLabel("Project name").fill("Saved before reload");
  await page.getByRole("button", { name: "Save and return" }).click();
  await context.addCookies([{ name: "creative-curator-test-auth-scenario", value: "auth-delay", url: "http://127.0.0.1:3100/", sameSite: "Lax" }]);

  let expectedSaved = "Saved before reload";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/projects/new", { waitUntil: "commit" });
    await expect(page.getByRole("status").filter({ hasText: "Loading saved diagnostic" })).toBeVisible();
    await expect(page.getByLabel("Project name")).toHaveCount(0);
    const title = page.getByLabel("Project name");
    await expect(title).toHaveValue(expectedSaved);
    expectedSaved = `Typed after hydration ${attempt}`;
    await title.fill(expectedSaved);
    await page.waitForTimeout(350);
    await expect(title).toHaveValue(expectedSaved);
  }
});

test("diagnostic bounds entries before creating a project", async ({ page }) => {
  await signInForTest(page, "/projects/new", "bounded@example.com");
  await page.getByLabel("Project name").fill("Bounded brand");
  let projectRequests = 0;
  let nodeRequests = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/projects" && request.method() === "POST") projectRequests += 1;
    if (/\/api\/projects\/[^/]+\/nodes$/.test(pathname)) nodeRequests += 1;
  });

  await page.getByLabel("Known facts").fill(Array.from({ length: 13 }, (_, index) => `Fact ${index + 1}`).join("\n"));
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "12 entries or fewer" })).toBeVisible();
  expect({ projectRequests, nodeRequests }).toEqual({ projectRequests: 0, nodeRequests: 0 });

  await page.getByLabel("Known facts").fill("x".repeat(501));
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "500 characters or fewer" })).toBeVisible();
  expect({ projectRequests, nodeRequests }).toEqual({ projectRequests: 0, nodeRequests: 0 });

  await page.getByLabel("Known facts").fill(Array.from({ length: 12 }, (_, index) => `Boundary fact ${index + 1}`).join("\n"));
  await page.getByRole("button", { name: "Create project" }).click();
  await expect.poll(() => nodeRequests, { timeout: 20_000 }).toBe(12);
  await expect(page.getByRole("heading", { name: "Project created" })).toBeVisible();
  expect(projectRequests).toBe(1);
});

test("partial seed failure preserves draft and recovery link", async ({ page }) => {
  await signInForTest(page, "/projects/new", "recovery@example.com");
  await page.getByLabel("Project name").fill("Recoverable");
  await page.getByLabel("Known facts").fill("First fact\nSecond fact");
  let nodeRequests = 0;
  await page.route(/\/api\/projects\/[^/]+\/nodes$/, async (route) => {
    nodeRequests += 1;
    if (nodeRequests === 2) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) });
    } else {
      const response = await route.fetch();
      await route.fulfill({ response });
    }
  });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect.poll(() => nodeRequests).toBe(2);
  await expect(page.getByRole("alert").filter({ hasText: "Project created, but some diagnostic notes were not saved" })).toBeVisible();
  const recovery = page.getByRole("link", { name: "Open Recoverable" });
  const href = await recovery.getAttribute("href");
  expect(href).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
  const projectId = href!.split("/").at(-1)!;
  const stored = await page.evaluate(({ projectId }) => {
    const prefix = "creative-curator:diagnostic:";
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
    return {
      keys,
      project: localStorage.getItem(keys.find((key) => key.endsWith(`:${projectId}`)) ?? ""),
      fresh: localStorage.getItem(keys.find((key) => key.endsWith(":new")) ?? ""),
    };
  }, { projectId });
  expect(stored.keys).toHaveLength(2);
  const projectKey = stored.keys.find((key) => key.endsWith(`:${projectId}`));
  const freshKey = stored.keys.find((key) => key.endsWith(":new"));
  expect(projectKey).toMatch(/^creative-curator:diagnostic:test-[^:]+:[0-9a-f-]{36}$/);
  expect(freshKey?.split(":").slice(0, 3)).toEqual(projectKey?.split(":").slice(0, 3));
  for (const copy of [stored.project, stored.fresh]) {
    expect(copy).toContain("Second fact");
    expect(copy).not.toContain("First fact");
  }
  await page.reload();
  await expect(page.getByLabel("Known facts")).toHaveValue("Second fact");
});

test("project list recovers for same account and isolates other owners", async ({ page }) => {
  await signInForTest(page, "/projects/new", "owner-a@example.com");
  await page.getByLabel("Project name").fill("Private Northline");
  let nodeRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/projects\/[^/]+\/nodes$/.test(new URL(request.url()).pathname)) nodeRequests += 1;
  });
  await page.getByRole("button", { name: "Skip diagnostic" }).click();
  await expect(page.getByRole("heading", { name: "Project created" })).toBeVisible();
  expect(nodeRequests).toBe(0);
  const projectHref = await page.getByRole("link", { name: "Open Private Northline" }).getAttribute("href");
  const projectId = projectHref!.split("/").at(-1)!;
  await signOutForTest(page);
  await signInForTest(page, "/projects", "owner-a@example.com");
  await expect(page.getByRole("row", { name: /Private Northline/ })).toBeVisible();
  await signOutForTest(page);
  await signInForTest(page, "/projects", "owner-b@example.com");
  await expect(page.getByText("Private Northline")).toHaveCount(0);
  const direct = await page.evaluate(async (projectId) => {
    const token = document.cookie.match(/creative-curator-test-auth=([^;]+)/)?.[1];
    const response = await fetch(`/api/projects/${projectId}`, { headers: { Authorization: `Bearer ${decodeURIComponent(token ?? "")}` } });
    return { status: response.status, body: await response.json() };
  }, projectId);
  expect(direct).toEqual({ status: 404, body: { detail: "Project not found." } });
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText("Private Northline")).toHaveCount(0);
});

test("project metadata failure is explicit and retryable", async ({ page }) => {
  await signInForTest(page, "/projects/new", "metadata@example.com");
  await page.getByLabel("Project name").fill("Status Brand");
  await page.getByRole("button", { name: "Skip diagnostic" }).click();
  await page.route(/\/api\/projects\/summaries(?:\?.*)?$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.goto("/projects");
  const alert = page.getByRole("alert").filter({ hasText: "Projects could not be loaded" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("row", { name: /Status Brand/ })).toHaveCount(0);
  await alert.getByRole("button", { name: "Retry projects" }).click();
  const row = page.getByRole("row", { name: /Status Brand/ });
  await expect(row).toContainText("Not ready");
  await expect(row).toContainText("0 unresolved");
});

test("project rows expose exact work status and navigation stays usable on mobile", async ({ page }) => {
  await signInForTest(page, "/projects/new", "row@example.com");
  await page.getByLabel("Project name").fill("Row Brand");
  await page.getByRole("button", { name: "Skip diagnostic" }).click();
  await expect(page.getByRole("heading", { name: "Project created" })).toBeVisible();
  let batchRequests = 0;
  let individualSummaryRequests = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/projects/summaries") batchRequests += 1;
    if (/\/api\/projects\/[^/]+\/summary$/.test(pathname)) individualSummaryRequests += 1;
  });
  await page.goto("/projects");
  const row = page.getByRole("row", { name: /Row Brand/ });
  await expect(row).toContainText("Not ready");
  await expect(row).toContainText("0 unresolved");
  await expect(row.getByRole("link", { name: "Open" })).toBeVisible();
  expect({ batchRequests, individualSummaryRequests }).toEqual({ batchRequests: 1, individualSummaryRequests: 0 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(navigation.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Sign out" })).toBeVisible();
});
