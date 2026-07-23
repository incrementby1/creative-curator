import type { Page } from "@playwright/test";

export const TEST_EMAIL = "owner@example.com";
export const TEST_PASSWORD = "correct-horse-1";

export async function signInForTest(page: Page, next = "/"): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

