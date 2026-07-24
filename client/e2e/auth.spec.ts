import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signInForTest, TEST_EMAIL as email, TEST_PASSWORD as password } from "./helpers/session";

const scenarioCookie = "creative-curator-test-auth-scenario";

async function setScenario(
  context: import("@playwright/test").BrowserContext,
  value: string,
) {
  await context.addCookies([{
    name: scenarioCookie,
    value,
    url: "http://127.0.0.1:3100/",
    sameSite: "Lax",
  }]);
}

test("protected routes preserve the intended destination", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);

  await page.goto("/settings?section=providers");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%3Fsection%3Dproviders$/);
});

test("sign in returns to the protected destination and survives refresh", async ({ page }) => {
  await signInForTest(page, "/settings?section=providers");
  await expect(page).toHaveURL(/\/settings\?section=providers$/);
  await page.reload();
  await expect(page).toHaveURL(/\/settings\?section=providers$/);
});

test("invalid credentials preserve email and clear and focus password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "Email or password is incorrect." }),
  ).toHaveText("Email or password is incorrect.");
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
});

test("password reveal exposes state through its accessible name", async ({ page }) => {
  await page.goto("/login");
  const passwordInput = page.getByLabel("Password", { exact: true });
  await passwordInput.fill(password);
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(passwordInput).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(passwordInput).toHaveAttribute("type", "password");
});

test("sign-up and sign-in validate fields on blur", async ({ page }) => {
  await page.goto("/login");
  const emailInput = page.getByLabel("Email");
  await emailInput.fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();

  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("short");
  await emailInput.click();
  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
});

test("sign out removes the cookie-backed session", async ({ page }) => {
  await signInForTest(page);
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
});

test("resolved sign-out failure stays usable and reports recovery", async ({ page, context }) => {
  await signInForTest(page);
  await setScenario(context, "signout-error");
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Unable to sign out. Try again." }),
  ).toBeVisible();
  await page.getByLabel("Brand name").fill("Still usable");
  await expect(page.getByLabel("Brand name")).toHaveValue("Still usable");
});

test("thrown sign-out failure stays usable and reports recovery", async ({ page, context }) => {
  await signInForTest(page);
  await setScenario(context, "signout-throw");
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Unable to sign out. Check your connection and try again." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeEnabled();
});

test("auth client initialization failure is stable and accessible", async ({ page, context }) => {
  await setScenario(context, "init-error");
  await page.goto("/login");

  await expect(
    page.getByRole("alert").filter({ hasText: "Authentication is unavailable." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Authentication is unavailable." }),
  ).toBeVisible();
});

test("protected sign-out controls stay disabled when auth initialization fails", async ({ page, context }) => {
  await signInForTest(page);
  await setScenario(context, "init-error");
  await page.reload();

  await expect(
    page.getByRole("alert").filter({ hasText: "Authentication is unavailable." }),
  ).toBeVisible();
  const desktopSignOut = page.getByRole("button", { name: "Sign out" });
  await expect(desktopSignOut).toBeDisabled();
  const desktopStyle = await desktopSignOut.evaluate((element) => ({
    cursor: getComputedStyle(element).cursor,
    opacity: Number(getComputedStyle(element).opacity),
  }));
  expect(desktopStyle.cursor).toBe("not-allowed");
  expect(desktopStyle.opacity).toBeLessThan(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileSignOut = page.getByRole("dialog", { name: "Primary navigation" })
    .getByRole("button", { name: "Sign out" });
  await expect(mobileSignOut).toBeDisabled();
  const mobileStyle = await mobileSignOut.evaluate((element) => ({
    cursor: getComputedStyle(element).cursor,
    opacity: Number(getComputedStyle(element).opacity),
  }));
  expect(mobileStyle.cursor).toBe("not-allowed");
  expect(mobileStyle.opacity).toBeLessThan(1);
});

test("the same email restores the same deterministic identity", async ({ page, context }) => {
  await signInForTest(page);
  const first = (await context.cookies()).find((cookie) => cookie.name === "creative-curator-test-auth")?.value;
  await page.getByRole("button", { name: "Sign out" }).click();
  await signInForTest(page);
  const second = (await context.cookies()).find((cookie) => cookie.name === "creative-curator-test-auth")?.value;
  expect(first).toMatch(/^test-user:test-/);
  expect(second).toBe(first);
});

test("unsafe intended destinations are rejected", async ({ page }) => {
  for (const unsafeNext of ["https://example.com/phish", "//example.com/phish", "/\\example.com/phish"]) {
    await page.context().clearCookies();
    await signInForTest(page, unsafeNext);
    await expect(page).toHaveURL(/\/$/);
    expect(new URL(page.url()).origin).toBe("http://127.0.0.1:3100");
  }
});

test("test configuration disables traces and guards Supabase construction", () => {
  const root = path.resolve(__dirname, "..");
  const config = readFileSync(path.join(root, "playwright.config.ts"), "utf8");
  const browserAuth = readFileSync(path.join(root, "app/lib/supabase/browser.ts"), "utf8");
  expect(config).toContain('trace: "off"');
  expect(browserAuth).toContain("isTestAuthMode()\n    ? Promise.resolve(createTestAuthClient())\n    : createProductionAuthClient()");
});
