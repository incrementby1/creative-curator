import { expect, test } from "@playwright/test";

async function startSession(page: import("@playwright/test").Page) {
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
}

test("guided workspace completes the Hermes creative loop", async ({ page }) => {
  await startSession(page);

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

test("rejection drafts survive workspace navigation", async ({ page }) => {
  await startSession(page);
  await page.getByRole("button", { name: /Outputs/ }).click();

  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Optional note").fill("Feels too polished for regular mornings");
  await page.getByLabel("Rejection reason").selectOption("not_authentic");

  await page.getByRole("button", { name: /DNA/ }).click();
  await page.getByRole("button", { name: /Outputs/ }).click();

  await expect(page.getByLabel("Reject Premium Artisan")).toBeChecked();
  await expect(page.getByLabel("Optional note")).toHaveValue(
    "Feels too polished for regular mornings",
  );
  await expect(page.getByLabel("Rejection reason")).toHaveValue("not_authentic");
  await expect(page.getByLabel("Rejection reason").locator("option:checked")).toHaveText(
    "Not authentic",
  );
});

test("desktop header regions do not overlap", async ({ page }) => {
  await page.goto("/");

  const wordmark = await page.getByRole("button", { name: "Creative Curator" }).boundingBox();
  const status = await page.locator("header").getByText("Ready for a brief").boundingBox();

  expect(wordmark).not.toBeNull();
  expect(status).not.toBeNull();
  expect(wordmark!.x + wordmark!.width).toBeLessThanOrEqual(status!.x);
});

test("closed mobile drawer stays out of keyboard order", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const menu = page.getByRole("button", { name: "Open navigation" });
  const wordmark = page.getByRole("button", { name: "Creative Curator" });
  const brandName = page.getByLabel("Brand name");

  await menu.focus();
  await page.keyboard.press("Tab");
  await expect(wordmark).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(brandName).toBeFocused();

  await menu.click();
  await expect(page.getByRole("button", { name: /Brief/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  await menu.click();
  await page.getByRole("button", { name: /Brief/ }).click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  await menu.click();
  await page.locator("main > button").click({ position: { x: 370, y: 100 } });
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await expect(page.locator('aside[aria-label="Primary navigation"]')).toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.locator('aside[aria-label="Primary navigation"]')).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});
