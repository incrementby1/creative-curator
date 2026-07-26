import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

async function createProject(page: import("@playwright/test").Page) {
  await signInForTest(page, "/projects/new", "blueprint@example.com");
  await page.getByLabel("Project name").fill("Northline Blueprint");
  await page.getByLabel("Known facts").fill("Customers need one clear next step");
  await page.getByLabel("Assumptions").fill("Calm direction earns trust");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Open Northline Blueprint" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
  return page.url().match(/\/projects\/([^/?]+)$/)![1];
}

test("Blueprint creates canonical snapshot, preserves history, and exposes source navigation", async ({ page }) => {
  const projectId = await createProject(page);
  await page.goto(`/projects/${projectId}/blueprint`);
  await expect(page.getByRole("heading", { name: "Starter Brand Blueprint" })).toBeVisible();
  await page.getByRole("button", { name: "Create snapshot" }).click();
  await expect(page.getByRole("button", { name: /Snapshot 01/ })).toBeVisible();
  await expect(page.locator(".blueprint-readiness")).toContainText("Early Blueprint");
  await expect(page.getByRole("heading", { name: "Evidence & assumptions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open source node" }).first()).toHaveAttribute("href", new RegExp(`/projects/${projectId}\\?node=`));
  const firstText = await page.locator("[data-blueprint-document=true]").innerText();
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.goto(`/projects/${projectId}/blueprint`);
  await expect(page.getByRole("status")).toContainText("newer than this immutable snapshot");
  expect(await page.locator("[data-blueprint-document=true]").innerText()).toBe(firstText);
  await page.getByRole("button", { name: "Create snapshot" }).click();
  await expect(page.getByRole("button", { name: /Snapshot 02/ })).toBeVisible();
  await page.getByRole("button", { name: /Snapshot 01/ }).click();
  await expect(page.getByRole("status")).toContainText("newer than this immutable snapshot");
  expect(await page.locator("[data-blueprint-document=true]").innerText()).toBe(firstText);
  await page.getByRole("link", { name: "Open source node" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?node=`));
  await expect(page.getByRole("region", { name: "Node inspector" })).toBeVisible();
});

test("Blueprint print keeps semantic document and removes application chrome", async ({ page }) => {
  const projectId = await createProject(page);
  await page.goto(`/projects/${projectId}/blueprint`);
  await page.getByRole("button", { name: "Create snapshot" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header").first()).toBeHidden();
  await expect.poll(() => page.locator("[data-print-hidden=true]").evaluateAll((items) => items.every((item) => getComputedStyle(item).display === "none"))).toBe(true);
  await expect(page.locator("[data-blueprint-document=true]")).toBeVisible();
  await expect(page.getByText(/Graph version \d+/).first()).toBeVisible();
});

test("Blueprint reports snapshot version conflicts without losing history", async ({ page }) => {
  const projectId = await createProject(page);
  await page.goto(`/projects/${projectId}/blueprint`);
  await page.route(new RegExp(`/api/projects/${projectId}/blueprints$`), (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "version_conflict" } }) })
    : route.continue());
  await page.getByRole("button", { name: "Create snapshot" }).click();
  await expect(page.locator(".blueprint-inline-error")).toContainText("Graph changed before this snapshot could be created");
  await expect(page.getByText("Blueprint has no published edition yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create snapshot" })).toBeEnabled();
});

test("Blueprint remains readable on desktop and mobile in every theme", async ({ page }) => {
  const projectId = await createProject(page);
  for (const theme of ["paper", "graphite", "project"] as const) {
    await page.goto(`/projects/${projectId}`);
    await page.getByRole("button", { name: "Theme" }).click();
    await page.locator(".theme-selector__menu select").first().selectOption(theme);
    await page.goto(`/projects/${projectId}/blueprint`);
    await expect(page.locator(".blueprint-workspace")).toHaveAttribute("data-theme", theme);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("heading", { name: "Starter Brand Blueprint" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
