import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { readyUser } from "./helpers/session";

const authScenarioCookie = "creative-curator-test-auth-scenario";

async function setAuthScenario(
  context: import("@playwright/test").BrowserContext,
  value: string,
) {
  await context.addCookies([{
    name: authScenarioCookie,
    value,
    url: "http://127.0.0.1:3100/",
    sameSite: "Lax",
  }]);
}

test.beforeEach(async ({ page }, testInfo) => {
  const slug = testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 42);
  await readyUser(page, `${slug}@workspace.test`);
  await page.goto("/studio");
});

function clientSource(directory: string): string {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return clientSource(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? fs.readFileSync(entryPath, "utf8") : "";
  }).join("\n");
}

async function startSession(page: import("@playwright/test").Page) {
  await page.goto("/studio");
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
  await page.getByLabel("Reject Test Direction 1").check();
  await page.getByLabel("Reject Test Direction 2").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();
  await expect(page.getByRole("heading", { name: /Refined/ })).toBeVisible();
}

test("legacy studio remains available during rollout", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL("/studio");
  await expect(
    page.getByRole("heading", { name: /Shape the brief/i }),
  ).toBeVisible();
});

test("workspace contains no disconnected prototype controls", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.getByText("Placeholder reply", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Scheduler", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Provide API key", { exact: true })).toHaveCount(0);
  await expect(page.getByText("What are we shaping today?", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Drag the cards", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Beliefs and tone sliders", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Review the three options", { exact: true })).toHaveCount(0);
});

test("workspace preserves draft while visiting Settings", async ({ page }) => {
  await page.getByLabel("Brand name").fill("Draft Brand");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Legacy workspace" }).click();
  await expect(page.getByLabel("Brand name")).toHaveValue("Draft Brand");
});

test("AI configuration errors offer direct Settings recovery", async ({ page }) => {
  await page.route("**/api/creative/start", (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({
      detail: {
        code: "ai_configuration_required",
        message: "Connect a provider and save routing before generating.",
      },
    }),
  }));
  await page.getByLabel("Brand name").fill("Northstar Coffee");
  await page.getByLabel("One-sentence description").fill("Premium coffee for city mornings.");
  await page.getByRole("button", { name: "Generate directions" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Connect a provider and save routing");
  await expect(status.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
});

test("Clear Workbench has no banned editorial treatments", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/studio");
    const audit = await page.evaluate(() => ({
      serif: getComputedStyle(document.querySelector("h1")!).fontFamily
        .toLowerCase()
        .split(",")
        .map((family) => family.trim().replaceAll('"', ""))
        .some((family) => family === "serif" || family.includes("iowan") || family.includes("palatino") || family.includes("georgia")),
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      tinyTargets: [...document.querySelectorAll<HTMLElement>("button, a")]
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden"
            && rect.width > 0 && rect.height > 0 && rect.height < 44;
        })
        .map((node) => node.getAttribute("aria-label") || node.textContent?.trim() || node.tagName),
    }));
    expect(audit).toEqual({ serif: false, horizontalOverflow: false, tinyTargets: [] });
  }

  const css = ["shell.module.css", "workspace.module.css", "forms.module.css"]
    .map((file) => fs.readFileSync(path.resolve(__dirname, "../app/styles", file), "utf8"))
    .join("\n");
  expect(css).not.toMatch(/radial-gradient|linear-gradient|backdrop-filter|text-transform:\s*uppercase/i);
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
  await page.goto("/studio");
  await page.getByLabel("Brand name").fill("Northstar Coffee");
  await page.getByLabel("One-sentence description").fill("Valid description");
  await page.getByLabel("Optional goal").fill("Increase qualified local visits");
  await page.getByRole("button", { name: "Generate directions" }).click();

  await expect(page.getByRole("status")).toContainText("Service is unavailable. Try again.");
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
  await expect(page.getByRole("status")).toContainText("Service is unavailable. Try again.");
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
  await expect(page.getByRole("status")).toContainText("Service is unavailable. Try again.");
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

  await page.getByLabel("Reject Test Direction 1").check();
  await page.getByLabel("Optional note").fill("Feels too polished for regular mornings");
  await page.getByLabel("Rejection reason").selectOption("not_authentic");

  await page.getByRole("button", { name: /DNA/ }).click();
  await page.getByRole("button", { name: /Outputs/ }).click();

  await expect(page.getByLabel("Reject Test Direction 1")).toBeChecked();
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

  await page.getByLabel("Reject Test Direction 1").check();
  await page.getByLabel("Reject Test Direction 2").check();
  await page.getByLabel("Rejection reason").nth(0).selectOption("not_authentic");
  await page.getByLabel("Rejection reason").nth(1).selectOption("too_loud");
  await page.getByLabel("Optional note").nth(0).fill("Too polished for regular mornings");
  await page.getByLabel("Optional note").nth(1).fill("Too chaotic for a calm routine");

  await page.getByRole("button", { name: "Refine remaining direction" }).click();

  await expect(page.getByRole("status")).toContainText("Service is unavailable. Try again.");
  await expect(page.getByLabel("Reject Test Direction 1")).toBeChecked();
  await expect(page.getByLabel("Reject Test Direction 2")).toBeChecked();
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
  await page.getByLabel("Reject Test Direction 1").check();
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
  await page.getByLabel("Reject Test Direction 1").check();
  await page.getByLabel("Reject Test Direction 2").check();
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
  await page.getByLabel("Reject Test Direction 1").check();
  await page.getByLabel("Reject Test Direction 2").check();
  await page.getByRole("button", { name: "Refine remaining direction" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Requested resource was not found.");
  await status.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByLabel("Brand name")).toHaveValue("");
  await expect(page.getByRole("button", { name: /DNA/ })).toBeDisabled();
});

test("desktop header regions do not overlap", async ({ page }) => {
  await page.goto("/studio");

  const wordmark = await page.getByRole("button", { name: "Creative Curator" }).boundingBox();
  const status = await page.locator("header").getByText("Ready for a brief").boundingBox();

  expect(wordmark).not.toBeNull();
  expect(status).not.toBeNull();
  expect(wordmark!.x + wordmark!.width).toBeLessThanOrEqual(status!.x);
});

test("closed mobile drawer stays out of keyboard order", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");

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
  await expect(dialog.getByRole("button", { name: "Sign out" })).toBeFocused();
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

for (const scenario of ["signout-error", "signout-throw"] as const) {
  test(`mobile ${scenario} closes navigation and exposes recovery`, async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/studio");
    await setAuthScenario(context, scenario);

    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog", { name: "Primary navigation" })
      .getByRole("button", { name: "Sign out" })
      .click();

    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole("dialog", { name: "Primary navigation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
    const alert = page.getByRole("alert").filter({ hasText: "Unable to sign out" });
    await expect(alert).toBeVisible();
    expect(await alert.evaluate((element) => Boolean(element.closest("[inert]")))).toBe(false);
    await page.getByLabel("Brand name").fill("Still usable");
    await expect(page.getByLabel("Brand name")).toHaveValue("Still usable");
  });
}

test("mobile drawer isolates skip link until the modal closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");
  const skipLink = page.locator('a[href="#main-content"]');

  await page.getByRole("button", { name: "Open navigation" }).click();
  const firstItem = page.getByRole("dialog", { name: "Primary navigation" })
    .getByRole("button", { name: /Brief/ });
  await expect(firstItem).toBeFocused();
  await expect(skipLink).toHaveAttribute("inert", "");
  await expect(skipLink).toHaveAttribute("aria-hidden", "true");
  await skipLink.focus();
  await expect(firstItem).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(skipLink).not.toHaveAttribute("inert", "");
  await expect(skipLink).not.toHaveAttribute("aria-hidden", "true");
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
});

test("mobile drawer closes when layout becomes desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Primary navigation" })).toBeVisible();

  await page.setViewportSize({ width: 1200, height: 844 });

  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(page.locator('aside[aria-label="Primary navigation"]')).not.toHaveAttribute(
    "aria-modal",
    "true",
  );
  await expect(page.locator("main > header")).not.toHaveAttribute("inert", "");
});

test("mobile protected-route choices close the drawer and restore its opener", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("dialog", { name: "Primary navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Primary navigation" })
    .getByRole("link", { name: "Legacy workspace" })
    .click();

  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
});

test("mobile workspace completes the creative loop without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSession(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: /Outputs/ }).click();
  await expect(page.getByRole("heading", { name: "Three creative directions" })).toBeVisible();
  await expect(page.locator("article[data-direction-id]")).toHaveCount(3);
  await page.getByLabel("Reject Test Direction 1").check();
  await page.getByLabel("Reject Test Direction 2").check();
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
