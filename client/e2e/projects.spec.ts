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
  await expect(page.getByRole("heading", { name: "Project created" })).toBeVisible();
  await expect.poll(() => nodeBodies.length).toBe(7);

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
  await page.getByRole("link", { name: "Create project" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Unfinished brand");
  await expect(page.getByLabel("Known facts")).toHaveValue("One verified fact");
  await expect(page.getByLabel("Assumptions")).toHaveValue("");
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
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Project created, but some diagnostic notes were not saved" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Recoverable" })).toHaveAttribute("href", /\/projects\/.+/);
  await page.reload();
  await expect(page.getByLabel("Known facts")).toHaveValue("Second fact");
});

test("project list recovers for same account and isolates other owners", async ({ page }) => {
  await signInForTest(page, "/projects/new", "owner-a@example.com");
  await page.getByLabel("Project name").fill("Private Northline");
  await page.getByRole("button", { name: "Skip diagnostic" }).click();
  await expect(page.getByRole("heading", { name: "Project created" })).toBeVisible();
  await signOutForTest(page);
  await signInForTest(page, "/projects", "owner-a@example.com");
  await expect(page.getByRole("row", { name: /Private Northline/ })).toBeVisible();
  await signOutForTest(page);
  await signInForTest(page, "/projects", "owner-b@example.com");
  await expect(page.getByText("Private Northline")).toHaveCount(0);
});

test("project rows expose exact work status and navigation stays usable on mobile", async ({ page }) => {
  await signInForTest(page, "/projects/new", "row@example.com");
  await page.getByLabel("Project name").fill("Row Brand");
  await page.getByRole("button", { name: "Skip diagnostic" }).click();
  await page.goto("/projects");
  const row = page.getByRole("row", { name: /Row Brand/ });
  await expect(row).toContainText("Not ready");
  await expect(row).toContainText("0 unresolved");
  await expect(row.getByRole("link", { name: "Open" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(navigation.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Sign out" })).toBeVisible();
});
