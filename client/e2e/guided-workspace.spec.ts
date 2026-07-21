import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function clientSource(directory: string): string {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return clientSource(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? fs.readFileSync(entryPath, "utf8") : "";
  }).join("\n");
}

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
  await expect(page.getByRole("heading", { name: "Brand DNA" })).toBeVisible();
}

async function startAndRefine(page: import("@playwright/test").Page) {
  await startSession(page);
  await page.getByRole("button", { name: /Outputs/ }).click();
  await expect(page.getByRole("heading", { name: "Three creative directions" })).toBeVisible();
  await expect(page.locator("article[data-direction-id]")).toHaveCount(3);
  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Reject Internet Chaos").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();
  await expect(page.getByRole("heading", { name: /Refined/ })).toBeVisible();
}

test("legacy studio redirects to guided workspace", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: /Shape the brief/i }),
  ).toBeVisible();
});

test("workspace contains no disconnected prototype controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Placeholder reply", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Scheduler", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Provide API key", { exact: true })).toHaveCount(0);
  await expect(page.getByText("What are we shaping today?", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Drag the cards", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Beliefs and tone sliders", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Review the three options", { exact: true })).toHaveCount(0);
});

test("client source contains no live SVG injection or legacy static workspace", () => {
  const source = clientSource(path.resolve(__dirname, "../app"));

  expect(source).not.toContain("dangerouslySetInnerHTML");
  expect(source).not.toContain("Placeholder reply");
  expect(source).not.toContain("Drag the cards, pan the surface");
  expect(source).not.toContain("Beliefs and tone sliders");
  expect(source).not.toContain("Review the three options");
});

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

test("approval recovers when the first successful response is lost", async ({ page }) => {
  let approveAttempts = 0;
  await page.route("**/api/creative/approve", async (route) => {
    approveAttempts += 1;
    if (approveAttempts === 1) {
      await route.fetch();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await startAndRefine(page);
  await page.getByRole("button", { name: "Approve and generate artifact" }).click();
  await expect(page.getByRole("status")).toContainText("Creative service unavailable");
  await expect(
    page.getByRole("button", { name: "Approve and generate artifact" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Approve and generate artifact" }).click();
  await expect(page.getByRole("heading", { name: "Final artifact" })).toBeVisible();
  expect(approveAttempts).toBe(2);
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

test("failed rejection keeps every selected draft", async ({ page }) => {
  await page.route("**/api/creative/reject", async (route) => {
    await route.abort("failed");
  });

  await startSession(page);
  await page.getByRole("button", { name: /Outputs/ }).click();

  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Reject Internet Chaos").check();
  await page.getByLabel("Rejection reason").nth(0).selectOption("not_authentic");
  await page.getByLabel("Rejection reason").nth(1).selectOption("too_loud");
  await page.getByLabel("Optional note").nth(0).fill("Too polished for regular mornings");
  await page.getByLabel("Optional note").nth(1).fill("Too chaotic for a calm routine");

  await page.getByRole("button", { name: "Refine remaining direction" }).click();

  await expect(page.getByRole("status")).toContainText("Creative service unavailable");
  await expect(page.getByLabel("Reject Premium Artisan")).toBeChecked();
  await expect(page.getByLabel("Reject Internet Chaos")).toBeChecked();
  await expect(page.getByLabel("Rejection reason").nth(0)).toHaveValue("not_authentic");
  await expect(page.getByLabel("Rejection reason").nth(1)).toHaveValue("too_loud");
  await expect(page.getByLabel("Optional note").nth(0)).toHaveValue(
    "Too polished for regular mornings",
  );
  await expect(page.getByLabel("Optional note").nth(1)).toHaveValue(
    "Too chaotic for a calm routine",
  );
});

test("Start over clears brief and rejection drafts", async ({ page }) => {
  await startSession(page);
  await page.getByRole("button", { name: /Outputs/ }).click();
  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Rejection reason").selectOption("not_authentic");
  await page.getByLabel("Optional note").fill("Do not carry this into a new session");

  await page.getByRole("button", { name: /Brief/ }).click();
  await page.getByRole("button", { name: "Start over" }).click();

  await expect(page.getByLabel("Brand name")).toHaveValue("");
  await expect(page.getByLabel("One-sentence description")).toHaveValue("");
  await expect(page.getByLabel("Optional goal")).toHaveValue("");
  await expect(page.getByLabel("Optional reference")).toHaveValue("");

  await page.getByLabel("Brand name").fill("Second Session");
  await page.getByLabel("One-sentence description").fill("A clean second creative session.");
  await page.getByRole("button", { name: "Generate directions" }).click();
  await page.getByRole("button", { name: /Outputs/ }).click();
  await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0);
  await expect(page.getByLabel("Optional note")).toHaveCount(0);
});

test("Start over ignores a delayed stale rejection response", async ({ page }) => {
  let releaseResponse = () => {};
  let completeResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const responseCompleted = new Promise<void>((resolve) => {
    completeResponse = resolve;
  });
  await page.route("**/api/creative/reject", async (route) => {
    await responseGate;
    const response = await route.fetch();
    await route.fulfill({ response });
    completeResponse();
  });

  await startSession(page);
  await page.getByRole("button", { name: /Outputs/ }).click();
  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Reject Internet Chaos").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();
  await page.getByRole("button", { name: /Brief/ }).click();
  await page.getByRole("button", { name: "Start over" }).click();
  releaseResponse();
  await responseCompleted;

  await expect(page.getByRole("heading", { name: /Shape the brief/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /DNA/ })).toBeDisabled();
  await expect(page.getByLabel("Brand name")).toHaveValue("");
});

test("missing session error offers direct Start over recovery", async ({ page }) => {
  await page.route("**/api/creative/reject", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Creative session not found." }),
    });
  });

  await startSession(page);
  await page.getByRole("button", { name: /Outputs/ }).click();
  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Reject Internet Chaos").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Creative session not found");
  await status.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByLabel("Brand name")).toHaveValue("");
  await expect(page.getByRole("button", { name: /DNA/ })).toBeDisabled();
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
  const dialog = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("main > header")).toHaveAttribute("inert", "");
  expect(await page.getByLabel("Brand name").evaluate((element) => Boolean(element.closest("[inert]")))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: /Brief/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Brief/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  await menu.click();
  await page.getByRole("button", { name: /Brief/ }).click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  await menu.click();
  await page.locator("[data-drawer-backdrop]").click({ position: { x: 370, y: 100 } });
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

test("mobile drawer closes when layout becomes desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Primary navigation" })).toBeVisible();

  await page.setViewportSize({ width: 1200, height: 844 });

  const menu = page.locator("main > header button").first();
  await expect(menu).toHaveAttribute("aria-label", "Open navigation");
  await expect(menu).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator('aside[aria-label="Primary navigation"]')).not.toHaveAttribute(
    "aria-modal",
    "true",
  );
  await expect(page.locator("main > header")).not.toHaveAttribute("inert", "");
});

test("mobile workspace completes the creative loop without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSession(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: /Outputs/ }).click();
  await expect(page.getByRole("heading", { name: "Three creative directions" })).toBeVisible();
  await expect(page.locator("article[data-direction-id]")).toHaveCount(3);
  await page.getByLabel("Reject Premium Artisan").check();
  await page.getByLabel("Reject Internet Chaos").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();
  await expect(page.getByRole("heading", { name: /Refined/ })).toBeVisible();
  await page.getByRole("button", { name: "Approve and generate artifact" }).click();

  await expect(page.getByRole("heading", { name: "Final artifact" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Generated creative layout" })).toBeVisible();
  const widths = await page.locator("html").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});
