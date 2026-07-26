import { expect, test, type Page } from "@playwright/test";
import {
  connectProvider,
  signInForTest,
  signOutForTest,
} from "./helpers/session";

test("settings sanitizes unsafe analysis return destinations", async ({ page }) => {
  await signInForTest(page, "/settings?returnTo=%2F%2Fevil.example", "unsafe-return@example.com");
  await expect(page.getByRole("link", { name: "Return to preserved analysis" })).toHaveCount(0);
});

async function settingsToken(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "creative-curator-test-auth",
  );
  if (!cookie) throw new Error("Test auth cookie is missing.");
  return decodeURIComponent(cookie.value);
}

async function settingsRequest(
  page: Page,
  method: "GET" | "PUT",
  path: string,
  data?: object,
) {
  return page.request.fetch(`/api/settings${path}`, {
    method,
    headers: { Authorization: `Bearer ${await settingsToken(page)}` },
    data,
  });
}

async function openSettings(page: Page, email: string) {
  await signInForTest(page, "/settings", email);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "AI provider settings" })).toBeVisible();
}

test("catalog loads with explicit provider and routing states", async ({ page }) => {
  await openSettings(page, "catalog@example.test");
  await expect(page.getByRole("heading", { name: "Provider connections" })).toBeVisible();
  await expect(page.getByText("OpenRouter", { exact: true })).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model routing" })).toBeVisible();
  await expect(page.getByLabel("Primary provider")).toBeVisible();
});

test("provider filter is labeled, case-insensitive, ordered, and recoverable", async ({ page }) => {
  await openSettings(page, "filter@example.test");
  const filter = page.getByLabel("Filter providers");
  await expect(filter).toBeVisible();
  await expect(page.getByText("28 providers shown")).toBeVisible();
  await filter.fill("deepSEEK");
  await expect(page.getByRole("heading", { name: "DeepSeek", exact: true })).toBeVisible();
  await expect(page.getByText("1 provider shown")).toBeVisible();
  await filter.fill("open");
  const names = await page.locator("article h3").allTextContents();
  expect(names.slice(0, 3)).toEqual(["OpenRouter", "Custom OpenAI-compatible", "OpenAI API"]);
  await filter.fill("no-such-provider");
  await expect(page.getByText("No providers match this filter.")).toBeVisible();
  await page.getByRole("button", { name: "Clear provider filter" }).click();
  await expect(page.getByText("28 providers shown")).toBeVisible();
});

test("settings API sends Bearer and retries one 401 with a fresh auth read", async ({ page }) => {
  let requests = 0;
  const authorizations: string[] = [];
  await page.route("**/api/settings/providers", async (route) => {
    requests += 1;
    authorizations.push(route.request().headers().authorization ?? "");
    if (requests === 1) {
      await route.fulfill({ status: 401, contentType: "application/json", body: '{"detail":"expired"}' });
      return;
    }
    await route.continue();
  });

  await openSettings(page, "retry@example.test");
  await expect.poll(() => requests).toBe(2);
  expect(authorizations).toHaveLength(2);
  expect(authorizations.every((value) => value.startsWith("Bearer test-user:"))).toBeTruthy();
});

test("a final settings 401 returns to login with intended route", async ({ page }) => {
  await page.route("**/api/settings/providers", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: '{"detail":"expired"}',
  }));
  await signInForTest(page, "/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});

test("typed provider errors render safe recovery without key disclosure", async ({ page }) => {
  await openSettings(page, "typed-error@example.test");
  await page.route("**/api/settings/providers/openrouter/test", (route) => route.fulfill({
    status: 422,
    contentType: "application/json",
    body: '{"detail":{"code":"provider_connection_failed","category":"auth"}}',
  }));
  await page.getByRole("button", { name: "Connect OpenRouter", exact: true }).click();
  await page.getByLabel("OpenRouter API key").fill("test-never-render-4F2A");
  await page.getByLabel("OpenRouter model").fill("openrouter-test-model");
  await page.getByRole("button", { name: "Test OpenRouter connection" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Provider rejected this key" })).toHaveText(
    "Provider rejected this key. Check it and test again.",
  );
  await expect(page.getByText("test-never-render-4F2A")).toHaveCount(0);
});

test("provider test and save masks key and persists for same owner", async ({ page }) => {
  await openSettings(page, "persist@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");

  await expect(page.getByText("Connected, key ending 4F2A")).toBeVisible();
  await expect(page.getByText("test-key-4F2A")).toHaveCount(0);
  await signOutForTest(page);
  await signInForTest(page, "/settings", "persist@example.test");
  await expect(page.getByText("Connected, key ending 4F2A")).toBeVisible();
  await expect(page.getByText("test-key-4F2A")).toHaveCount(0);
});

test("connected provider has one Manage action with replace, reveal, and disconnect inside", async ({ page }) => {
  await openSettings(page, "manage@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "OpenRouter", exact: true }) });
  await expect(row.getByRole("button", { name: "Manage OpenRouter" })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(1);
  await row.getByRole("button", { name: "Manage OpenRouter" }).click();
  await expect(row.getByRole("button", { name: "Show key for OpenRouter" })).toBeVisible();
  await row.getByLabel("OpenRouter API key").fill("replacement-key");
  await row.getByRole("button", { name: "Show key for OpenRouter" }).click();
  await expect(row.getByLabel("OpenRouter API key")).toHaveAttribute("type", "text");
  await expect(row.getByRole("button", { name: "Disconnect OpenRouter" })).toBeVisible();
});

test("failed provider save preserves key and model draft with safe recovery", async ({ page }) => {
  await openSettings(page, "failed-save@example.test");
  await page.getByRole("button", { name: "Connect OpenRouter", exact: true }).click();
  const key = page.getByLabel("OpenRouter API key");
  const model = page.getByLabel("OpenRouter model");
  await key.fill("test-key-4F2A");
  await model.fill("openrouter-test-model");
  await page.getByRole("button", { name: "Test OpenRouter connection" }).click();
  await page.route("**/api/settings/providers/openrouter", (route) => {
    if (route.request().method() === "PUT") return route.fulfill({
      status: 422,
      contentType: "application/json",
      body: '{"detail":{"code":"invalid_provider_configuration"}}',
    });
    return route.continue();
  });
  await page.getByRole("button", { name: "Save OpenRouter connection" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Check the model and endpoint" })).toBeVisible();
  await expect(key).toHaveValue("test-key-4F2A");
  await expect(model).toHaveValue("openrouter-test-model");
});

test("needs-attention provider remains explicit and manageable", async ({ page }) => {
  await page.route("**/api/settings/providers", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const provider = payload.providers.find((item: { slug: string }) => item.slug === "openrouter");
    provider.state = "needs_attention";
    provider.masked_suffix = "4F2A";
    await route.fulfill({ response, json: payload });
  });
  await openSettings(page, "needs-attention@example.test");
  const row = page.getByRole("article").filter({ hasText: "OpenRouter" });
  await expect(row.getByText("Needs attention, key ending 4F2A")).toBeVisible();
  await expect(row.getByRole("button", { name: "Manage OpenRouter" })).toBeVisible();
});

test("provider model discovery keeps manual entry available", async ({ page }) => {
  await openSettings(page, "discovery@example.test");
  await page.getByRole("button", { name: "Connect OpenRouter", exact: true }).click();
  await page.getByLabel("OpenRouter API key").fill("test-key-4F2A");
  await page.getByLabel("OpenRouter model").fill("manual/model");
  await page.getByRole("button", { name: "Test OpenRouter connection" }).click();

  await expect(page.locator('#openrouter-models option[value="openrouter-test-model"]')).toBeAttached();
  await expect(page.getByLabel("OpenRouter model")).toHaveValue("manual/model");
});

test("discovery failure preserves verified connection and manual model recovery", async ({ page }) => {
  await openSettings(page, "discovery-failure@example.test");
  await page.route("**/api/settings/providers/openrouter/models", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: '{"detail":{"code":"provider_connection_failed","category":"unavailable"}}',
  }));
  await page.getByRole("button", { name: "Connect OpenRouter", exact: true }).click();
  await page.getByLabel("OpenRouter API key").fill("test-key-4F2A");
  await page.getByLabel("OpenRouter model").fill("manual/model");
  await page.getByRole("button", { name: "Test OpenRouter connection" }).click();

  await expect(page.getByText("Connection verified. Model list unavailable; enter a model manually.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save OpenRouter connection" })).toBeEnabled();
});

test("another owner cannot see saved key metadata", async ({ page }) => {
  await openSettings(page, "first@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await signOutForTest(page);
  await signInForTest(page, "/settings", "second@example.test");

  await expect(page.getByRole("button", { name: "Connect OpenRouter", exact: true })).toBeVisible();
  await expect(page.getByText("key ending 4F2A")).toHaveCount(0);
});

test("disconnect requires inline confirmation and returns focus", async ({ page }) => {
  await openSettings(page, "disconnect@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await page.getByRole("button", { name: "Manage OpenRouter" }).click();
  await page.getByLabel("OpenRouter API key").fill("replacement-draft");
  await page.getByLabel("OpenRouter model").fill("replacement-model");
  await page.getByRole("button", { name: "Show key for OpenRouter" }).click();
  await page.getByRole("button", { name: "Disconnect OpenRouter" }).click();

  const cancel = page.getByRole("button", { name: "Cancel disconnect OpenRouter" });
  const confirm = page.getByRole("button", { name: "Confirm disconnect OpenRouter" });
  await expect(page.getByText("Remove this saved key?" )).toBeVisible();
  await expect(confirm).toBeFocused();
  await cancel.click();
  await expect(page.getByRole("button", { name: "Disconnect OpenRouter" })).toBeFocused();
  await page.getByRole("button", { name: "Disconnect OpenRouter" }).click();
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(page.getByRole("button", { name: "Connect OpenRouter", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect OpenRouter", exact: true }).click();
  await expect(page.getByLabel("OpenRouter API key")).toHaveValue("");
  await expect(page.getByLabel("OpenRouter API key")).toHaveAttribute("type", "password");
  await expect(page.getByLabel("OpenRouter model")).toHaveValue("");
});

test("failed disconnect preserves replacement draft for recovery", async ({ page }) => {
  await openSettings(page, "failed-disconnect@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await page.getByRole("button", { name: "Manage OpenRouter" }).click();
  const key = page.getByLabel("OpenRouter API key");
  const model = page.getByLabel("OpenRouter model");
  await key.fill("replacement-draft");
  await model.fill("replacement-model");
  await page.route("**/api/settings/providers/openrouter", (route) => {
    if (route.request().method() === "DELETE") return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: '{"detail":{"code":"provider_in_use"}}',
    });
    return route.continue();
  });
  await page.getByRole("button", { name: "Disconnect OpenRouter" }).click();
  await page.getByRole("button", { name: "Confirm disconnect OpenRouter" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Remove this provider from routing" })).toBeVisible();
  await expect(key).toHaveValue("replacement-draft");
  await expect(model).toHaveValue("replacement-model");
});

test("pending disconnect locks teardown controls until success clears state", async ({ page }) => {
  await openSettings(page, "pending-disconnect@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await page.getByRole("button", { name: "Manage OpenRouter" }).click();
  await page.getByLabel("OpenRouter API key").fill("replacement-draft");
  await page.getByLabel("OpenRouter model").fill("replacement-model");

  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
  await page.route("**/api/settings/providers/openrouter", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    await deleteGate;
    await route.continue();
  });

  await page.getByRole("button", { name: "Disconnect OpenRouter" }).click();
  const confirm = page.getByRole("button", { name: "Confirm disconnect OpenRouter" });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel disconnect OpenRouter" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close OpenRouter settings" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Show key for OpenRouter" })).toBeDisabled();
  await expect(page.getByLabel("OpenRouter API key")).toBeDisabled();
  await expect(page.getByLabel("OpenRouter model")).toBeDisabled();
  await expect(page.getByLabel("OpenRouter API key")).toHaveValue("replacement-draft");

  releaseDelete();
  await expect(page.getByRole("button", { name: "Connect OpenRouter", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect OpenRouter", exact: true }).click();
  await expect(page.getByLabel("OpenRouter API key")).toHaveValue("");
  await expect(page.getByLabel("OpenRouter API key")).toHaveAttribute("type", "password");
});

test("fallback routing is ordered, keyboard operable, and capped at five", async ({ page }) => {
  await openSettings(page, "routing@example.test");
  for (const [name, slug] of [
    ["OpenRouter", "openrouter"],
    ["DeepSeek", "deepseek"],
    ["Google AI Studio", "gemini"],
    ["OpenAI API", "openai-api"],
    ["Anthropic", "anthropic"],
    ["xAI", "xai"],
  ] as const) {
    await connectProvider(page, name, `test-${slug}-4F2A`, `${slug}-test-model`);
  }
  await page.getByLabel("Primary provider").selectOption("openrouter");
  await expect(page.getByRole("button", { name: "Save routing" })).toBeDisabled();
  await page.getByLabel("Primary model").fill("openrouter-test-model");
  await expect(page.getByRole("button", { name: "Save routing" })).toBeEnabled();

  for (const [index, slug] of ["deepseek", "gemini", "openai-api", "anthropic", "xai"].entries()) {
    await page.getByRole("button", { name: "Add fallback" }).click();
    await expect(page.getByRole("button", { name: "Save routing" })).toBeDisabled();
    const row = page.getByTestId("fallback-row").nth(index);
    await row.getByLabel("Provider").selectOption(slug);
    await row.getByLabel("Model").fill(`${slug}-test-model`);
  }
  await expect(page.getByRole("button", { name: "Add fallback" })).toBeDisabled();
  await page.getByRole("button", { name: "Move Google AI Studio up" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("fallback-row").first()).toContainText("Google AI Studio");
  await page.getByRole("button", { name: "Remove xAI" }).click();
  await expect(page.getByTestId("fallback-row")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Add fallback" })).toBeEnabled();
  await page.getByRole("button", { name: "Save routing" }).click();
  await expect(page.getByText("Routing saved.")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "OpenRouter" })).toContainText(
    "Primary · openrouter-test-model",
  );
  await expect(page.getByRole("article").filter({ hasText: "Google AI Studio" })).toContainText(
    "Fallback 1 · gemini-test-model",
  );
});

test("routing rejects exact duplicate pairs but allows same provider with another model", async ({ page }) => {
  await openSettings(page, "routing-duplicates@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await page.getByLabel("Primary provider").selectOption("openrouter");
  await page.getByLabel("Primary model").fill("openrouter-test-model");
  await page.getByRole("button", { name: "Add fallback" }).click();
  const fallback = page.getByTestId("fallback-row");
  await fallback.getByLabel("Provider").selectOption("openrouter");
  await fallback.getByLabel("Model").fill("  openrouter-test-model  ");
  await expect(page.getByRole("button", { name: "Save routing" })).toBeDisabled();
  await expect(page.getByText("Primary route cannot also be an exact fallback.")).toBeVisible();

  await fallback.getByLabel("Model").fill("openrouter-secondary-model");
  await expect(page.getByRole("button", { name: "Save routing" })).toBeEnabled();
  await page.getByRole("button", { name: "Add fallback" }).click();
  const duplicateFallback = page.getByTestId("fallback-row").nth(1);
  await duplicateFallback.getByLabel("Provider").selectOption("openrouter");
  await duplicateFallback.getByLabel("Model").fill(" openrouter-secondary-model ");
  await expect(page.getByRole("button", { name: "Save routing" })).toBeDisabled();
  await expect(page.getByText("Fallback routes must be unique by provider and model.")).toBeVisible();

  await duplicateFallback.getByLabel("Model").fill("openrouter-third-model");
  await expect(page.getByRole("button", { name: "Save routing" })).toBeEnabled();
});

test("routing conflict reloads latest version with recovery message", async ({ page }) => {
  await openSettings(page, "conflict@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await page.getByLabel("Primary provider").selectOption("openrouter");
  await page.getByLabel("Primary model").fill("openrouter-test-model");

  const current = await settingsRequest(page, "GET", "/routing");
  const routing = await current.json();
  const advanced = await settingsRequest(page, "PUT", "/routing", {
    primary: { provider_slug: "openrouter", model: "external-model" },
    fallbacks: [],
    version: routing.version,
  });
  expect(advanced.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save routing" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Settings changed elsewhere" })).toContainText(
    "Settings changed elsewhere. Latest routing loaded.",
  );
  await expect(page.getByLabel("Primary model")).toHaveValue("external-model");
});

test("owner can clear routing then disconnect the sole formerly routed provider", async ({ page }) => {
  await openSettings(page, "clear-routing@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await page.getByLabel("Primary provider").selectOption("openrouter");
  await page.getByLabel("Primary model").fill("openrouter-test-model");
  await page.getByRole("button", { name: "Save routing" }).click();
  await expect(page.getByText("Routing saved.")).toBeVisible();

  await page.getByLabel("Primary provider").selectOption("");
  await expect(page.getByRole("button", { name: "Save routing" })).toBeEnabled();
  await page.getByRole("button", { name: "Save routing" }).click();
  await expect(page.getByText("Routing saved.")).toBeVisible();

  await page.getByRole("button", { name: "Manage OpenRouter" }).click();
  await page.getByRole("button", { name: "Disconnect OpenRouter" }).click();
  await page.getByRole("button", { name: "Confirm disconnect OpenRouter" }).click();
  await expect(page.getByRole("button", { name: "Connect OpenRouter", exact: true })).toBeVisible();
});

test("needs-attention sole route remains clearable before disconnect", async ({ page }) => {
  await openSettings(page, "clear-attention@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await page.getByLabel("Primary provider").selectOption("openrouter");
  await page.getByLabel("Primary model").fill("openrouter-test-model");
  await page.getByRole("button", { name: "Save routing" }).click();

  let showNeedsAttention = true;
  await page.route("**/api/settings/providers", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    if (showNeedsAttention) {
      const provider = payload.providers.find((item: { slug: string }) => item.slug === "openrouter");
      provider.state = "needs_attention";
    }
    await route.fulfill({ response, json: payload });
  });
  await page.reload();

  const primary = page.getByLabel("Primary provider");
  await expect(primary).toBeEnabled();
  await expect(primary).toHaveValue("openrouter");
  await expect(primary.getByRole("option", { name: "OpenRouter (needs attention)" })).toBeAttached();
  await primary.selectOption("");
  await expect(page.getByRole("button", { name: "Save routing" })).toBeEnabled();
  await page.getByRole("button", { name: "Save routing" }).click();
  await expect(page.getByText("Routing saved.")).toBeVisible();

  await page.getByRole("button", { name: "Manage OpenRouter" }).click();
  await page.getByRole("button", { name: "Disconnect OpenRouter" }).click();
  showNeedsAttention = false;
  await page.getByRole("button", { name: "Confirm disconnect OpenRouter" }).click();
  await expect(page.getByRole("button", { name: "Connect OpenRouter", exact: true })).toBeVisible();
});

test("routing Save is disabled when primary or fallback is no longer connected", async ({ page }) => {
  await openSettings(page, "stale-routing@example.test");
  await connectProvider(page, "OpenRouter", "test-key-4F2A", "openrouter-test-model");
  await connectProvider(page, "DeepSeek", "test-deepseek-4F2A", "deepseek-test-model");
  await page.getByLabel("Primary provider").selectOption("openrouter");
  await page.getByLabel("Primary model").fill("openrouter-test-model");
  await page.getByRole("button", { name: "Add fallback" }).click();
  const fallback = page.getByTestId("fallback-row");
  await fallback.getByLabel("Provider").selectOption("deepseek");
  await fallback.getByLabel("Model").fill("deepseek-test-model");
  await page.getByRole("button", { name: "Save routing" }).click();

  let unavailable = "deepseek";
  await page.route("**/api/settings/providers", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const provider = payload.providers.find((item: { slug: string }) => item.slug === unavailable);
    provider.state = "needs_attention";
    await route.fulfill({ response, json: payload });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Save routing" })).toBeDisabled();

  unavailable = "openrouter";
  await page.reload();
  await expect(page.getByRole("button", { name: "Save routing" })).toBeDisabled();
});

test("settings meets responsive target, focus, and reduced-motion rules", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openSettings(page, `responsive-${width}@example.test`);
    const connect = page.getByRole("button", { name: "Connect OpenRouter", exact: true });
    await connect.focus();
    await expect(connect).toBeFocused();
    const audit = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      tinyTargets: [...document.querySelectorAll("button, a, input, select")].filter(
        (node) => node.getBoundingClientRect().height < 44,
      ).length,
      outline: getComputedStyle(document.activeElement as Element).outlineStyle,
      reducedMotion: [...document.querySelectorAll("main, main *")].every((element) =>
        getComputedStyle(element).transitionDuration.split(",").every((duration) => {
          const milliseconds = duration.trim().endsWith("ms")
            ? Number.parseFloat(duration)
            : Number.parseFloat(duration) * 1000;
          return milliseconds <= 0.01;
        }),
      ),
    }));
    expect(audit).toEqual({
      overflow: false,
      tinyTargets: 0,
      outline: "solid",
      reducedMotion: true,
    });
    await signOutForTest(page);
  }
});
