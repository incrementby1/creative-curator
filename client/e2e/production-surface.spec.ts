import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

test("production navigation and Projects expose no legacy product", async ({ page }) => {
  await signInForTest(page, "/projects/new", "production-surface@example.com");
  await page.getByLabel("Project name").fill("Production Brand");
  await page.getByRole("button", { name: "Skip diagnostic" }).click();
  const projectLink = page.getByRole("link", { name: "Open Production Brand" });
  const projectHref = await projectLink.getAttribute("href");
  expect(projectHref).toMatch(/^\/projects\/[0-9a-f-]{36}$/);

  await page.goto("/projects");
  const desktopNavigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(desktopNavigation.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(desktopNavigation.getByRole("link", { name: "Production Brand" })).toHaveAttribute("href", projectHref!);
  await expect(desktopNavigation.getByRole("link", { name: "Blueprint" })).toHaveAttribute("href", `${projectHref}/blueprint`);
  await expect(desktopNavigation.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Legacy workspace" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Legacy sessions" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileNavigation = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(mobileNavigation.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Production Brand" })).toHaveAttribute("href", projectHref!);
  await expect(mobileNavigation.getByRole("link", { name: "Blueprint" })).toHaveAttribute("href", `${projectHref}/blueprint`);
  await expect(mobileNavigation.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Legacy workspace" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  const studioResponse = await page.goto("/studio");
  expect(studioResponse?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /not found|could not be found/i })).toBeVisible();

  const legacyResponse = await page.goto("/projects/legacy/old-session");
  expect(legacyResponse?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /not found|could not be found/i })).toBeVisible();
});
