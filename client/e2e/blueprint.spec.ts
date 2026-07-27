import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

async function createProject(page: import("@playwright/test").Page, isolationKey: string) {
  await signInForTest(page, "/projects/new", `blueprint-${isolationKey}@example.com`);
  await page.getByLabel("Project name").fill(`Northline Blueprint ${isolationKey}`);
  await page.getByLabel("Known facts").fill("Customers need one clear next step");
  await page.getByLabel("Assumptions").fill("Calm direction earns trust");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: `Open Northline Blueprint ${isolationKey}` }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
  return page.url().match(/\/projects\/([^/?]+)$/)![1];
}

test("Blueprint creates canonical snapshot, preserves history, and exposes source navigation", async ({ page }, testInfo) => {
  const projectId = await createProject(page, `history-${testInfo.repeatEachIndex}-${testInfo.workerIndex}`);
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

test("Blueprint print keeps semantic document and removes application chrome", async ({ page }, testInfo) => {
  const projectId = await createProject(page, `print-${testInfo.repeatEachIndex}-${testInfo.workerIndex}`);
  await page.goto(`/projects/${projectId}/blueprint`);
  await page.getByRole("button", { name: "Create snapshot" }).click();
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.goto(`/projects/${projectId}/blueprint`);
  await page.route(new RegExp(`/api/projects/${projectId}/blueprints$`), (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "version_conflict" } }) })
    : route.continue());
  await page.getByRole("button", { name: "Create snapshot" }).click();
  await expect(page.locator(".blueprint-inline-error")).toBeVisible();
  await expect(page.locator(".blueprint-stale")).toBeVisible();
  await expect(page.locator(".blueprint-readiness")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header").first()).toBeHidden();
  await expect.poll(() => page.locator("[data-print-hidden=true]").evaluateAll((items) => items.every((item) => getComputedStyle(item).display === "none"))).toBe(true);
  await expect(page.locator("[data-blueprint-document=true]")).toBeVisible();
  await expect(page.locator(".blueprint-stale")).toBeHidden();
  await expect(page.locator(".blueprint-inline-error")).toBeHidden();
  await expect(page.locator(".blueprint-readiness")).toBeVisible();
  const printableSources = page.locator("[data-source-id]");
  await expect(printableSources.first()).toBeVisible();
  expect(await printableSources.first().textContent()).not.toBe("");
  await expect(page.getByText(/Graph version \d+/).first()).toBeVisible();
});

test("Blueprint reports snapshot version conflicts without losing history", async ({ page }, testInfo) => {
  const projectId = await createProject(page, `conflict-${testInfo.repeatEachIndex}-${testInfo.workerIndex}`);
  await page.goto(`/projects/${projectId}/blueprint`);
  await page.route(new RegExp(`/api/projects/${projectId}/blueprints$`), (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "version_conflict" } }) })
    : route.continue());
  await page.getByRole("button", { name: "Create snapshot" }).click();
  await expect(page.locator(".blueprint-inline-error")).toContainText("Snapshot retry remains bound to graph version");
  await expect(page.getByText("Blueprint has no published edition yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create snapshot" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Retry version/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel retry" })).toBeVisible();
});

test("Blueprint remains readable on desktop and mobile in every theme", async ({ page }, testInfo) => {
  const projectId = await createProject(page, `themes-${testInfo.repeatEachIndex}-${testInfo.workerIndex}`);
  await page.goto(`/projects/${projectId}/blueprint`);
  await page.getByRole("button", { name: "Create snapshot" }).click();
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
    await page.emulateMedia({ media: "print" });
    const printAudit = await page.locator(".blueprint-document").evaluate((document) => {
      const parse = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      const linear = (value: number) => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; };
      const luminance = (value: string) => { const [r, g, b] = parse(value).map(linear); return r * .2126 + g * .7152 + b * .0722; };
      const accent = getComputedStyle(document.querySelector<HTMLElement>(".blueprint-cover")!).borderBottomColor;
      const white = "rgb(255, 255, 255)"; const values = [luminance(accent), luminance(white)].sort((a, b) => b - a);
      return { accentContrast: (values[0] + .05) / (values[1] + .05), background: getComputedStyle(document).backgroundColor };
    });
    expect(printAudit.accentContrast).toBeGreaterThanOrEqual(3);
    expect(printAudit.background).toBe("rgb(255, 255, 255)");
    await page.emulateMedia({ media: "screen" });
  }
});

test("Blueprint uses restrained workbench hierarchy on desktop and mobile", async ({ page }, testInfo) => {
  const projectId = await createProject(page, `workbench-${testInfo.repeatEachIndex}-${testInfo.workerIndex}`);
  await page.goto(`/projects/${projectId}/blueprint`);
  await page.getByRole("button", { name: "Create snapshot" }).click();

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const audit = await page.locator(".blueprint-workspace").evaluate((workspace) => {
      const all = [...workspace.querySelectorAll<HTMLElement>("*")];
      const hierarchy = [...workspace.querySelectorAll<HTMLElement>("h1, h2, h3")];
      const labels = [...workspace.querySelectorAll<HTMLElement>(".blueprint-toolbar p, .blueprint-history > span, .blueprint-kicker, .blueprint-cover dt, .blueprint-section__index, .blueprint-entry__meta")];
      const persistentSurfaces = [...workspace.querySelectorAll<HTMLElement>(".blueprint-document, .blueprint-cover, .blueprint-section, .blueprint-entry, .blueprint-history button")];
      return {
        gradientCount: all.filter((node) => getComputedStyle(node).backgroundImage.includes("gradient")).length,
        maxHeadingSize: Math.max(...hierarchy.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))),
        persistentShadowCount: persistentSurfaces.filter((node) => getComputedStyle(node).boxShadow !== "none").length,
        serifCount: all.filter((node) => {
          const primaryFamily = getComputedStyle(node).fontFamily.split(",")[0].replaceAll(/['"]/g, "").trim();
          return /^(georgia|times new roman|serif)$/i.test(primaryFamily);
        }).length,
        uppercaseLabelCount: labels.filter((node) => getComputedStyle(node).textTransform === "uppercase").length,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(audit.gradientCount).toBe(0);
    expect(audit.maxHeadingSize).toBeLessThanOrEqual(32);
    expect(audit.persistentShadowCount).toBe(0);
    expect(audit.serifCount).toBe(0);
    expect(audit.uppercaseLabelCount).toBe(0);
    expect(audit.horizontalOverflow).toBe(false);
  }
  await expect(page.getByText("Blueprint workspace", { exact: true })).toBeVisible();
});
