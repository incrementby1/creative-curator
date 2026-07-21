import { expect, test } from "@playwright/test";

test("guided workspace completes the Hermes creative loop", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Brand name").fill("Northstar Coffee");
  await page
    .getByLabel("One-sentence description")
    .fill("A premium coffee brand for busy city mornings.");
  await page.getByLabel("Optional goal").fill("Increase qualified local visits");
  await page
    .getByLabel("Optional reference")
    .fill("Warm, useful, and confident");
  await page.getByRole("button", { name: "Generate directions" }).click();

  await expect(page.getByRole("button", { name: /DNA/ })).toBeEnabled();
  await page.getByRole("button", { name: /DNA/ }).click();
  await expect(page.getByRole("heading", { name: "Brand DNA" })).toBeVisible();

  await page.getByRole("button", { name: /Outputs/ }).click();
  await expect(
    page.getByRole("heading", { name: "Three creative directions" }),
  ).toBeVisible();
  await expect(page.locator("article[data-direction-id]")).toHaveCount(3);

  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Reject Internet Chaos").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();
  await expect(page.getByRole("heading", { name: /Refined/ })).toBeVisible();

  await page
    .getByRole("button", { name: "Approve and generate artifact" })
    .click();
  await expect(page.getByRole("heading", { name: "Final artifact" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Generated creative layout" }),
  ).toBeVisible();
});
