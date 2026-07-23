import type { Page } from "@playwright/test";

export const TEST_EMAIL = "owner@example.com";
export const TEST_PASSWORD = "correct-horse-1";

export async function signInForTest(
  page: Page,
  next = "/",
  email = TEST_EMAIL,
): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function signOutForTest(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);
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
