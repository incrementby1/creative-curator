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

async function startAndRefine(page: import("@playwright/test").Page) {
  await startSession(page);
  await page.getByRole("button", { name: /Outputs/ }).click();
  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Reject Internet Chaos").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();
  await expect(page.getByRole("heading", { name: /Refined/ })).toBeVisible();
}

test("guided workspace completes the Hermes creative loop", async ({ page }) => {
  await startAndRefine(page);

  await page.getByRole("button", { name: /DNA/ }).click();
  await expect(page.getByRole("heading", { name: "Brand DNA" })).toBeVisible();

  await page.getByRole("button", { name: /Outputs/ }).click();

  await page
    .getByRole("button", { name: "Approve and generate artifact" })
    .click();
  await expect(page.getByRole("heading", { name: "Final artifact" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Generated creative layout" }),
  ).toBeVisible();
});

test("brief keeps user input when backend validation fails", async ({ page }) => {
  await page.route("**/api/creative/start", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Brief validation failed." }),
    });
  });
  await page.goto("/");
  await page.getByLabel("Brand name").fill("Northstar Coffee");
  await page.getByLabel("One-sentence description").fill("Valid description");
  await page.getByLabel("Optional goal").fill("Increase qualified local visits");
  await page.getByRole("button", { name: "Generate directions" }).click();

  await expect(page.getByRole("status")).toContainText("Brief validation failed");
  await expect(page.getByLabel("Brand name")).toHaveValue("Northstar Coffee");
  await expect(page.getByLabel("Optional goal")).toHaveValue(
    "Increase qualified local visits",
  );
});

test("artifact generation retries without approving twice", async ({ page }) => {
  let executeAttempts = 0;
  let approveAttempts = 0;
  await page.route("**/api/creative/execute", async (route) => {
    executeAttempts += 1;
    if (executeAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Artifact service unavailable." }),
      });
      return;
    }

    await route.continue();
  });
  await page.route("**/api/creative/approve", async (route) => {
    approveAttempts += 1;
    await route.continue();
  });

  await startAndRefine(page);
  await page.getByRole("button", { name: "Approve and generate artifact" }).click();
  await expect(page.getByRole("status")).toContainText("Artifact service unavailable");
  await expect(page.getByRole("button", { name: "Generate artifact" })).toBeVisible();
  await page.getByRole("button", { name: "Generate artifact" }).click();
  await expect(page.getByRole("heading", { name: "Final artifact" })).toBeVisible();
  expect(executeAttempts).toBe(2);
  expect(approveAttempts).toBe(1);
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
