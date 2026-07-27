import type { Page } from "@playwright/test";

export const TEST_EMAIL = "owner@example.com";
export const TEST_PASSWORD = "correct-horse-1";

export async function signInForTest(
  page: Page,
  next = "/projects",
  email = TEST_EMAIL,
): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function signOutForTest(page: Page): Promise<void> {
  const signOut = page.getByRole("button", { name: "Sign out" });
  if (!(await signOut.isVisible())) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog", { name: "Primary navigation" })
      .getByRole("button", { name: "Sign out" })
      .click();
  } else {
    await signOut.click();
  }
  await page.waitForURL((url) => url.pathname === "/login");
}

export async function connectProvider(
  page: Page,
  name: string,
  key: string,
  model: string,
): Promise<void> {
  await page.getByRole("button", { name: `Connect ${name}`, exact: true }).click();
  await page.getByLabel(`${name} API key`).fill(key);
  await page.getByLabel(`${name} model`).fill(model);
  await page.getByRole("button", { name: `Test ${name} connection` }).click();
  await page.getByRole("button", { name: `Save ${name} connection` }).click();
}

export async function configuredSettings(
  page: Page,
  email = TEST_EMAIL,
): Promise<void> {
  await signInForTest(page, "/settings", email);
  await connectProvider(
    page,
    "OpenRouter",
    "test-openrouter-4F2A",
    "openrouter-test-model",
  );
  await page.getByLabel("Primary provider").selectOption("openrouter");
  await page.getByLabel("Primary model").fill("openrouter-test-model");
  await page.getByRole("button", { name: "Save routing" }).click();
}
