import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

test("production navigation and Projects expose no legacy product", async ({ page }) => {
  await signInForTest(page, "/projects", "production-surface@example.com");
  await expect(page.getByRole("link", { name: "Legacy workspace" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Legacy sessions" })).toHaveCount(0);

  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: /not found|could not be found/i })).toBeVisible();

  await page.goto("/projects/legacy/old-session");
  await expect(page.getByRole("heading", { name: /not found|could not be found/i })).toBeVisible();
});
