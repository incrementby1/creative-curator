import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

const authScenarioCookie = "creative-curator-test-auth-scenario";

async function setAuthScenario(
  context: import("@playwright/test").BrowserContext,
  value: string,
) {
  await context.addCookies([{ name: authScenarioCookie, value, url: "http://127.0.0.1:3100/", sameSite: "Lax" }]);
}

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

test("mobile production navigation traps focus and isolates background until dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInForTest(page, "/projects", "production-focus@example.com");
  const menu = page.getByRole("button", { name: "Open navigation" });
  const skipLink = page.locator('a[href="#main-content"]');
  await menu.click();
  const dialog = page.getByRole("dialog", { name: "Primary navigation" });
  const first = dialog.getByRole("link", { name: "Projects" });
  const last = dialog.getByRole("button", { name: "Sign out" });
  await expect(first).toBeFocused();
  await expect(page.locator("main > header")).toHaveAttribute("inert", "");
  await expect(page.locator("#main-content")).toHaveAttribute("inert", "");
  await expect(skipLink).toHaveAttribute("inert", "");
  await expect(skipLink).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  await page.locator("[data-drawer-backdrop]").click({ position: { x: 380, y: 100 } });
  await expect(menu).toBeFocused();
  await expect(skipLink).not.toHaveAttribute("inert", "");
  await expect(page.locator('aside[aria-label="Primary navigation"]')).toHaveAttribute("aria-hidden", "true");
});

test("mobile destination closes drawer and desktop transition clears modal state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInForTest(page, "/projects", "production-destination@example.com");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Primary navigation" }).getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.setViewportSize({ width: 1200, height: 844 });
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(page.locator('aside[aria-label="Primary navigation"]')).toHaveCount(0);
  await expect(page.locator("main > header")).not.toHaveAttribute("inert", "");
});

for (const scenario of ["signout-error", "signout-throw"] as const) {
  test(`mobile ${scenario} closes production navigation and keeps page usable`, async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInForTest(page, "/projects", `${scenario}@example.com`);
    await setAuthScenario(context, scenario);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog", { name: "Primary navigation" }).getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
    const alert = page.getByRole("alert").filter({ hasText: "Unable to sign out" });
    await expect(alert).toBeVisible();
    expect(await alert.evaluate((element) => Boolean(element.closest("[inert]")))).toBe(false);
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });
}
