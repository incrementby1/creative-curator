import { expect, test } from "@playwright/test";
import { configuredSettings, signInForTest } from "./helpers/session";

function opaqueContrastRatio(foreground: string, background: string): number {
  const parse = (color: string) => {
    const match = color.trim().match(/^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/i);
    if (!match) throw new Error(`Expected computed RGB color, received ${color}`);
    const channels = match.slice(1, 4).map(Number);
    if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) throw new Error(`RGB channel out of range: ${color}`);
    const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error(`Alpha out of range: ${color}`);
    if (alpha !== 1) throw new Error(`Expected opaque color, received ${color}`);
    return channels.map((channel) => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
  };
  const luminance = (color: string) => { const [red, green, blue] = parse(color); return .2126 * red + .7152 * green + .0722 * blue; };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + .05) / (darker + .05);
}

test("contrast audit rejects transparent and unknown colors", () => {
  expect(() => opaqueContrastRatio("rgba(0, 0, 0, 0)", "rgb(255, 255, 255)")).toThrow(/opaque/);
  expect(() => opaqueContrastRatio("transparent", "rgb(255, 255, 255)")).toThrow(/RGB/);
});

test("project editor requires authentication", async ({ page }) => {
  await page.goto("/projects/00000000-0000-4000-8000-000000000001");
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects%2F00000000-0000-4000-8000-000000000001$/);
});

test("theme preferences preserve global precedence, nullable override, reload, and safe failure", async ({ page }) => {
  await createProject(page);
  await page.getByRole("button", { name: "Theme" }).click();
  const projectTheme = page.locator(".theme-selector__menu select").nth(0);
  const globalTheme = page.locator(".theme-selector__menu select").nth(1);
  await globalTheme.selectOption("graphite");
  await expect(page.getByText("Effective theme: Graphite")).toBeVisible();
  await projectTheme.selectOption("paper");
  await expect(page.getByText("Effective theme: Paper")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Theme" }).click();
  await expect(globalTheme).toHaveValue("graphite");
  await expect(projectTheme).toHaveValue("paper");
  await projectTheme.selectOption("inherit");
  await expect(page.getByText("Effective theme: Graphite")).toBeVisible();
  await page.route(/\/api\/users\/me\/theme$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "store_unavailable" } }) }));
  await globalTheme.selectOption("paper");
  await expect(page.getByText("Global theme was not saved. Try again.")).toBeVisible();
  await expect(page.getByText("Effective theme: Graphite")).toBeVisible();
});

test("theme surfaces resolve to opaque theme-appropriate computed colors after reload", async ({ page }) => {
  await createProject(page);
  const audit = async () => page.evaluate(() => {
    const selectors = ["body", ".constellation-header", ".project-map", ".constellation-grid", ".constellation-canvas"];
    const channels = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
    const luminance = (value: string) => {
      const [r = 255, g = 255, b = 255] = channels(value); const linear = (channel: number) => { const x = channel / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; };
      return .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
    };
    return selectors.map((selector) => { const element = document.querySelector(selector); if (!element) return { selector, background: -1, text: -1, alpha: -1 }; const style = getComputedStyle(element); const alpha = channels(style.backgroundColor)[3] ?? 1; return { selector, background: luminance(style.backgroundColor), text: luminance(style.color), alpha }; });
  });
  for (const theme of ["paper", "project", "graphite"] as const) {
    const menu = page.locator(".theme-selector__menu"); if (!await menu.isVisible()) await page.getByRole("button", { name: "Theme", exact: true }).click();
    await Promise.all([page.waitForResponse((response) => response.url().endsWith("/theme") && response.request().method() === "PUT"), menu.locator("select").first().selectOption(theme)]);
    await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-theme", theme);
    if (theme === "graphite") { await page.reload(); await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-theme", "graphite"); }
    const colors = await audit();
    for (const color of colors) { expect(color.alpha, color.selector).toBe(1); if (theme === "graphite") { expect(color.background, color.selector).toBeLessThan(.12); expect(color.text, color.selector).toBeGreaterThan(.45); } else { expect(color.background, color.selector).toBeGreaterThan(.75); expect(color.text, color.selector).toBeLessThan(.3); } }
  }
});

test("all themes preserve responsive geometry, focus order, reduced motion, and first paint", async ({ page }, testInfo) => {
  await createProject(page);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Layout saved")).toBeVisible();
  const widths = [375, 390, 768, 1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Theme" }).click();
    const projectTheme = page.locator(".theme-selector__menu select").nth(0);
    let baseline: { boxes: number[][]; buttons: string[]; status: string } | null = null;
    for (const theme of ["paper", "graphite", "project"] as const) {
      await projectTheme.selectOption(theme);
      await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("button", { name: "Theme", exact: true })).toBeEnabled();
      if (width === 390 || width === 1440) await page.screenshot({ fullPage: true, path: testInfo.outputPath(`constellation-${theme}-${width}.png`) });
      const audit = await page.evaluate((mobile) => {
        const selectors = [".constellation-header", ".theme-selector__menu", mobile ? ".mobile-graph-navigator" : ".constellation-canvas", ".constellation-work-panel"];
        const boxes = selectors.map((selector) => { const rect = document.querySelector(selector)!.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; });
        const buttons = [...document.querySelectorAll<HTMLButtonElement>(".constellation-workspace button:not([disabled])")].map((button) => button.getAttribute("aria-label") || button.textContent?.trim() || "");
        return { boxes, buttons, status: document.querySelector(".constellation-save")?.textContent || "", overflow: document.documentElement.scrollWidth > innerWidth };
      }, width <= 640);
      expect(audit.overflow).toBe(false);
      for (const [x, , boxWidth] of audit.boxes) { expect(x).toBeGreaterThanOrEqual(-1); expect(x + boxWidth).toBeLessThanOrEqual(width + 1); }
      if (!baseline) baseline = audit;
      else {
        expect(audit.buttons).toEqual(baseline.buttons); expect(audit.status).toBe(baseline.status);
        audit.boxes.forEach((box, index) => box.forEach((value, part) => expect(value).toBeCloseTo(baseline!.boxes[index][part], 0)));
      }
    }
    await page.getByRole("button", { name: "Close theme preferences" }).click();
  }
  await page.getByRole("button", { name: "Theme" }).click();
  await page.locator(".theme-selector__menu select").nth(0).selectOption("graphite");
  await page.reload();
  await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-theme", "graphite");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const duration = await page.locator(".constellation-node").first().evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(["0s", "0.00001s", "1e-05s"]).toContain(duration);
});

async function createProject(page: import("@playwright/test").Page, authenticate = true) {
  if (authenticate) await signInForTest(page, "/projects/new", "constellation@example.com");
  else await page.goto("/projects/new");
  await page.getByLabel("Project name").fill("Northline system");
  await page.getByLabel("Known facts").fill("Customers move under time pressure");
  await page.getByLabel("Assumptions").fill("Calm language earns trust");
  await page.getByRole("button", { name: "Create project" }).click();
  const link = page.getByRole("link", { name: "Open Northline system" });
  await expect(link).toBeVisible();
  await link.click();
}

async function drawAnnotation(page: import("@playwright/test").Page) {
  const canvas = page.getByTestId("constellation-canvas");
  await page.getByRole("button", { name: "Draw" }).click();
  await canvas.dispatchEvent("pointerdown", { clientX: 500, clientY: 320, pointerId: 1, buttons: 1 });
  await canvas.dispatchEvent("pointermove", { clientX: 540, clientY: 340, pointerId: 1, buttons: 1 });
  await canvas.dispatchEvent("pointerup", { clientX: 540, clientY: 340, pointerId: 1 });
  await expect(page.getByText("Annotations saved")).toBeVisible();
}

test("one history pair follows graph and annotation chronology", async ({ page }) => {
  await createProject(page);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toBeVisible();
  await drawAnnotation(page);
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);
});

test("failed annotation undo stays visible and retryable", async ({ page }) => {
  await createProject(page);
  await drawAnnotation(page);
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);

  await page.route(/\/api\/projects\/[^/]+\/annotations$/, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ detail: { code: "project_store_unavailable" } }),
  }), { times: 1 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Annotations need attention")).toBeVisible();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);

  const retry = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/annotations$/.test(response.url()) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Undo" }).click();
  await retry;
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
});

test("history follows action invocation when graph creation is slower than annotation persistence", async ({ page }) => {
  await createProject(page);
  await page.route(/\/api\/projects\/[^/]+\/nodes$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  }, { times: 1 });
  await page.getByRole("button", { name: "Add thought" }).click();
  await drawAnnotation(page);
  await expect(page.getByText("Graph saved")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toBeVisible();
});

test("rapid annotation actions compose from latest persisted annotations", async ({ page }) => {
  await createProject(page);
  await page.route(/\/api\/projects\/[^/]+\/annotations$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const canvas = page.getByTestId("constellation-canvas");
  await page.getByRole("button", { name: "Draw" }).click();
  for (const offset of [0, 80]) {
    await canvas.dispatchEvent("pointerdown", { clientX: 420 + offset, clientY: 300, pointerId: 1, buttons: 1 });
    await canvas.dispatchEvent("pointermove", { clientX: 450 + offset, clientY: 330, pointerId: 1, buttons: 1 });
    await canvas.dispatchEvent("pointerup", { clientX: 450 + offset, clientY: 330, pointerId: 1 });
  }
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(2);
});

test("rapid erase intents compose and undo in chronology", async ({ page }) => {
  await createProject(page);
  await drawAnnotation(page);
  await drawAnnotation(page);
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(2);
  await page.route(/\/api\/projects\/[^/]+\/annotations$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.getByRole("button", { name: "Erase" }).click();
  const paths = page.locator("[data-annotation-layer=true] path");
  await paths.nth(0).dispatchEvent("pointerdown", { pointerId: 1, buttons: 1 });
  await paths.nth(1).dispatchEvent("pointerdown", { pointerId: 1, buttons: 1 });
  await expect(paths).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(paths).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(paths).toHaveCount(2);
});

test("Inspector relationship creation enters workspace history", async ({ page }) => {
  await createProject(page);
  await page.locator(".react-flow__node").first().click();
  await expect(page.getByRole("heading", { name: "Connect nodes" })).toBeVisible();
  await page.getByLabel("Connection target").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add relationship" }).click();
  await expect(page.getByText("Relationship saved")).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});

test("selected-node Inspector applies precise size by keyboard", async ({ page }) => {
  await createProject(page);
  const selectedNode = page.locator(".react-flow__node").first();
  await selectedNode.click();
  await expect(page.getByRole("heading", { name: "Size & position" })).toBeVisible();
  await page.getByLabel("Node width").fill("320");
  await page.getByLabel("Node height").fill("180");
  const layoutRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/layout$/);
  await page.getByRole("button", { name: "Apply node size" }).focus();
  await page.keyboard.press("Enter");
  expect((await layoutRequest).method()).toBe("PUT");
  await expect(page.getByLabel("Node size status")).toHaveText("Node size saved.");
  await expect.poll(() => selectedNode.evaluate((element) => (element as HTMLElement).offsetWidth)).toBe(320);
  await expect.poll(() => selectedNode.evaluate((element) => (element as HTMLElement).offsetHeight)).toBe(180);
});

test("failed Inspector size save preserves values and selection for retry", async ({ page }) => {
  await createProject(page);
  const selectedNode = page.locator(".react-flow__node").first(); await selectedNode.click();
  await page.getByLabel("Node width").fill("320"); await page.getByLabel("Node height").fill("180");
  await page.route(/\/api\/projects\/[^/]+\/layout$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.getByRole("button", { name: "Apply node size" }).click();
  await expect(page.getByLabel("Node size status")).toHaveText("Node size was not saved. Values preserved.");
  await expect(page.getByText("Layout needs attention")).toBeVisible();
  await expect(page.getByRole("region", { name: "Node inspector" })).toBeVisible();
  await expect(page.getByLabel("Node width")).toHaveValue("320"); await expect(page.getByLabel("Node height")).toHaveValue("180");
  await expect(selectedNode).toHaveClass(/selected/);
  const retryRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/layout$/); await page.getByRole("button", { name: "Apply node size" }).click();
  expect((await retryRequest).method()).toBe("PUT"); await expect(page.getByLabel("Node size status")).toHaveText("Node size saved.");
});

test("failed graph undo remains retryable without pending recovery replay", async ({ page }) => {
  await createProject(page);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+\/trash$/, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ detail: { code: "project_store_unavailable" } }),
  }), { times: 1 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Graph needs attention")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBeNull();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toHaveCount(0);
});

test("stale annotation history after reload never overwrites newer annotations", async ({ page }) => {
  await createProject(page);
  await drawAnnotation(page);
  await page.route(/\/api\/projects\/[^/]+$/, async (route) => {
    const response = await route.fetch(); const body = await response.json();
    const now = new Date().toISOString();
    await route.fulfill({ response, json: { ...body, annotation_version: body.annotation_version + 1, annotations: [...body.annotations, {
      id: crypto.randomUUID(), project_id: body.project.id, owner_id: body.annotations[0].owner_id, annotation_type: "freehand",
      path_points: [[10, 10], [20, 20]], color: "#111111", media_id: null, version: 1, created_at: now, updated_at: now,
    }] } });
  }, { times: 1 });
  await page.reload();
  let puts = 0; page.on("request", (request) => { if (request.method() === "PUT" && /\/annotations$/.test(request.url())) puts += 1; });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undo history is stale. Reload the project before continuing.")).toBeVisible();
  expect(puts).toBe(0);
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(2);
});

test("lost annotation undo response reconciles successful server state", async ({ page }) => {
  await createProject(page); await drawAnnotation(page);
  await page.route(/\/api\/projects\/[^/]+\/annotations$/, async (route) => { await route.fetch(); await route.abort("internetdisconnected"); }, { times: 1 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);
});

test("lost graph undo response retries the same durable idempotency key", async ({ page }) => {
  await createProject(page); await page.getByRole("button", { name: "Add thought" }).click(); await expect(page.getByText("Graph saved")).toBeVisible();
  const keys: string[] = [];
  await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+\/trash$/, async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (keys.length === 1) { await route.fetch(); await route.abort("internetdisconnected"); return; }
    await route.continue();
  });
  await page.getByRole("button", { name: "Undo" }).click(); await expect(page.getByText("Graph needs attention")).toBeVisible();
  await page.reload(); const retryResponse = page.waitForResponse(/\/api\/projects\/[^/]+\/nodes\/[^/]+\/trash$/); await page.getByRole("button", { name: "Undo" }).click();
  expect((await retryResponse).ok()).toBe(true);
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]); expect(keys[0]).not.toBe("");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toBeVisible();
});

test("terminal inverse recovery blocks later history edits until refresh finishes", async ({ page }) => {
  await createProject(page); await page.getByRole("button", { name: "Add thought" }).click(); await expect(page.getByText("Graph saved")).toBeVisible();
  await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+\/trash$/, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "version_conflict" } }) }), { times: 1 });
  let refreshStarted = false; let refreshFinished = false; let createStartedBeforeRefresh = false;
  await page.route(/\/api\/projects\/[^/]+$/, async (route) => { refreshStarted = true; await new Promise((resolve) => setTimeout(resolve, 500)); await route.continue(); refreshFinished = true; }, { times: 1 });
  page.on("request", (request) => { if (request.method() === "POST" && /\/nodes$/.test(request.url()) && !refreshFinished) createStartedBeforeRefresh = true; });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => refreshStarted).toBe(true);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect.poll(() => refreshFinished).toBe(true);
  expect(createStartedBeforeRefresh).toBe(false);
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toHaveCount(2);
});

test("desktop constellation supports spatial tools and isolated saves", async ({ page }) => {
  await createProject(page);
  await expect(page.getByRole("heading", { name: "Northline system" })).toBeVisible();
  const canvas = page.getByTestId("constellation-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const tool of ["Connect", "Draw", "Erase", "Add thought", "Add media"]) {
    await expect(page.getByRole("button", { name: tool })).toBeVisible();
  }
  await page.route(/\/api\/projects\/[^/]+\/(layout|annotations)$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });

  const layoutRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/layout$/);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByText("New thought")).toBeVisible();
  expect((await layoutRequest).method()).toBe("PUT");
  await expect(page.getByText("Layout saved")).toBeVisible();
  await expect(page.getByText("Graph saved")).toBeVisible();
  const undoResponse = page.waitForResponse(/\/api\/projects\/[^/]+\/nodes\/[^/]+\/trash$/);
  await page.getByRole("button", { name: "Undo" }).click(); await undoResponse;
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  await expect(page.locator(".react-flow__node").getByText("New thought")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => { const projectId = location.pathname.split("/").pop(); const key = Object.keys(localStorage).find((item) => item.startsWith("creative-curator:workspace-history:v1:") && item.endsWith(`:${projectId}`)); const value = key ? localStorage.getItem(key) : null; return Boolean(value && JSON.parse(value).future?.length > 0); })).toBe(true);
  await page.waitForTimeout(100);
  const redoResponse = page.waitForResponse(/\/api\/projects\/[^/]+\/nodes\/[^/]+\/restore$/);
  await page.getByRole("button", { name: "Redo" }).click(); await redoResponse;
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  await expect(page.getByText("New thought")).toBeVisible();

  await page.getByRole("button", { name: "Draw" }).click();
  await canvas.dispatchEvent("pointerdown", { clientX: 500, clientY: 320, pointerId: 1, buttons: 1 });
  await canvas.dispatchEvent("pointermove", { clientX: 530, clientY: 340, pointerId: 1, buttons: 1 });
  await canvas.dispatchEvent("pointermove", { clientX: 560, clientY: 330, pointerId: 1, buttons: 1 });
  const annotationRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/annotations$/);
  await canvas.dispatchEvent("pointerup", { clientX: 560, clientY: 330, pointerId: 1 });
  expect((await annotationRequest).method()).toBe("PUT");
  await expect(page.getByText("Annotations saved")).toBeVisible();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
  await expect(page.getByText("Annotations saved")).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);
  await page.getByRole("button", { name: "Erase" }).click();
  await page.locator("[data-annotation-layer=true] path").dispatchEvent("pointerdown", { pointerId: 2, buttons: 1 });
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);
  await page.getByLabel("Node types").getByLabel("Assumption").uncheck();
  await expect(page.getByText("Calm language earns trust")).toHaveCount(0);
  await page.getByLabel("Node types").getByLabel("Assumption").check();

  await expect(page.getByLabel("Constellation minimap")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit selection" }).click();
  await page.waitForTimeout(500);
  const savedViewport = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("creative-curator:viewport:"));
    return key ? JSON.parse(localStorage.getItem(key)!) as { x: number; y: number; zoom: number } : null;
  });
  expect(savedViewport).not.toBeNull();
  await page.reload();
  await expect(page.getByText("Customers move under time pressure")).toBeVisible();
  await expect(page.getByText("Calm language earns trust")).toBeVisible();
  await expect(page.getByText("New thought")).toBeVisible();
  const restoredStyle = await page.locator(".react-flow__viewport").getAttribute("style");
  const restored = restoredStyle?.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
  expect(restored).not.toBeNull();
  expect(Number(restored![1])).toBeCloseTo(savedViewport!.x, 3);
  expect(Number(restored![2])).toBeCloseTo(savedViewport!.y, 3);
  expect(Number(restored![3])).toBeCloseTo(savedViewport!.zoom, 3);
});

test("offline node edit queues per owner/project and replays after reload", async ({ page }) => {
  await createProject(page);
  await page.locator(".react-flow__node").first().click();
  await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/, (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Node title").fill("Recovered exact title");
  await page.getByRole("button", { name: "Save node" }).click();
  await expect(page.locator(".constellation-domain-error")).toContainText("Draft preserved");
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("creative-curator:pending-project-edits:v1") ?? "[]") as Array<Record<string, unknown>>);
  expect(pending).toHaveLength(1); expect(pending[0]).toMatchObject({ schemaVersion: 1, operation: "update_node" });
  expect(JSON.stringify(pending)).not.toMatch(/api.?key|provider|prompt|raw|secret|token|credential/i);
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await page.unroute(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".react-flow__node").getByText("Recovered exact title")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBeNull();
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});

test("queue storage denial keeps a truthful in-tab edit and warns only for known unsaved work", async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem; const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) { if (key === "creative-curator:pending-project-edits:v1") throw new DOMException("denied", "SecurityError"); return get.call(this, key); };
    Storage.prototype.setItem = function (key: string, value: string) { if (key === "creative-curator:pending-project-edits:v1") throw new DOMException("full", "QuotaExceededError"); return set.call(this, key, value); };
  });
  await createProject(page);
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
  await page.locator(".react-flow__node").first().click(); await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/, (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Node title").fill("In-tab only"); await page.getByRole("button", { name: "Save node" }).click();
  await expect(page.locator(".constellation-domain-error")).toContainText("Not stored—keep this tab open");
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
});

test("terminal validation failures never enter semantic recovery", async ({ page }) => {
  await createProject(page); await page.locator(".react-flow__node").first().click();
  await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/, (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail: { code: "invalid_project_request" } }) }));
  await page.getByLabel("Node title").fill("Rejected in tab"); await page.getByRole("button", { name: "Save node" }).click();
  await expect(page.locator(".constellation-domain-error")).toContainText("rejected");
  expect(await page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBeNull();
  await expect(page.getByLabel("Node title")).toHaveValue("Rejected in tab");
});

test("keep terminal recovery in tab unblocks later replay without requeueing held work", async ({ page }) => {
  await createProject(page); const projectId = page.url().split("/").pop()!; const nodeId = await page.locator(".react-flow__node").first().getAttribute("data-id"); expect(nodeId).toBeTruthy();
  await page.locator(".react-flow__node").first().click(); await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/, (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Node title").fill("Seed recovery"); await page.getByRole("button", { name: "Save node" }).click(); await expect(page.locator(".constellation-domain-error")).toContainText("queued locally");
  const seed = await page.evaluate(() => JSON.parse(localStorage.getItem("creative-curator:pending-project-edits:v1") ?? "[]")[0]); await page.unroute(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/);
  const now = "2026-07-27T00:00:00Z"; const records = [1, 2].map((index) => ({ ...seed, idempotencyKey: `terminal-held-${index}`, createdAt: index, payload: { ...seed.payload, input: { ...seed.payload.input, title: `Recovery ${index}` } } }));
  await page.evaluate((items) => localStorage.setItem("creative-curator:pending-project-edits:v1", JSON.stringify(items)), records);
  let attempts = 0; await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/, (route) => { attempts += 1; if (attempts === 1 || attempts === 3) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail: { code: "invalid_project_request" } }) }); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: nodeId, project_id: projectId, node_type: "evidence", title: "Recovery 2", content: "Semantic draft", state: "working", created_by: "user", provenance: null, tags: [], version: 2, created_at: now, updated_at: now }) }); });
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await expect.poll(() => attempts).toBe(1); const panel = page.getByRole("alertdialog", { name: "Local recovery needs review" }); await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Keep in tab" }).click(); await panel.getByRole("button", { name: "Confirm" }).click(); await expect(panel).toHaveCount(0); await expect.poll(() => attempts).toBe(2);
  const held = page.getByRole("region", { name: "Held recovery" }); await expect(held).toContainText("Recovery 1"); await expect.poll(() => page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBeNull(); expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => { window.dispatchEvent(new Event("online")); requestAnimationFrame(() => requestAnimationFrame(() => resolve())); })); expect(attempts).toBe(2); expect(await page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBeNull(); await expect(panel).toHaveCount(0);
  await held.getByRole("button", { name: "Apply recovered edit" }).click(); await held.getByRole("button", { name: "Confirm apply" }).click(); await expect(held).toContainText("not saved"); expect(attempts).toBe(3); expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await held.getByRole("button", { name: "Apply recovered edit" }).click(); await held.getByRole("button", { name: "Confirm apply" }).click(); await expect(held).toHaveCount(0); expect(attempts).toBe(4); expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});

test("provider failure preserves inspector draft and exact viewport", async ({ page }) => {
  await createProject(page); await page.locator(".react-flow__node").first().click();
  await page.getByLabel("Node title").fill("Unsaved provider-safe draft"); await page.getByRole("button", { name: "Zoom in" }).click();
  const before = await page.locator(".react-flow__viewport").getAttribute("style");
  await page.route(/\/api\/projects\/[^/]+\/analysis$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "all_providers_failed" } }) }));
  await page.getByRole("button", { name: "Explore selected node" }).click();
  await expect(page.getByText(/Hermes could not finish/)).toBeVisible(); expect(await page.locator(".react-flow__viewport").getAttribute("style")).toBe(before);
  await expect(page.getByLabel("Node title")).toHaveValue("Unsaved provider-safe draft");
});

test("queued replay conflict compares exact values and accept-latest clears pending", async ({ page }) => {
  await createProject(page); await page.locator(".react-flow__node").first().click();
  await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/, (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Node title").fill("Submitted queued title"); await page.getByRole("button", { name: "Save node" }).click();
  await expect(page.locator(".constellation-domain-error")).toContainText("queued locally");
  await page.unroute(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/); await page.route(/\/api\/projects\/[^/]+\/nodes\/[^/]+$/, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "version_conflict" } }) }));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const panel = page.getByRole("alertdialog", { name: "Version conflict" }); await expect(panel).toBeVisible(); await expect(panel.getByText("Submitted queued title")).toBeVisible();
  const pendingBefore = await page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1")); await panel.getByRole("button", { name: "Compare versions" }).click(); expect(await page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBe(pendingBefore);
  await panel.getByRole("button", { name: "Accept latest" }).click(); await expect(panel).toHaveCount(0); await expect.poll(() => page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBeNull();
});

test("keep-mine retries exact latest versions without losing queue, draft, focus, or viewport", async ({ page }) => {
  await createProject(page); await page.locator(".react-flow__node").first().click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const viewportBefore = await page.locator(".react-flow__viewport").getAttribute("style");
  const nodeRoute = /\/api\/projects\/[^/]+\/nodes\/[^/]+$/;
  await page.route(nodeRoute, (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Node title").fill("Submitted keep-mine title");
  await page.getByRole("button", { name: "Save node" }).click();
  await expect(page.locator(".constellation-domain-error")).toContainText("queued locally");
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem("creative-curator:pending-project-edits:v1") ?? "[]") as Array<{ idempotencyKey: string; expectedVersion: number; payload: { input: { expected_node_version: number } } }>);
  expect(queued).toHaveLength(1); const oldKey = queued[0].idempotencyKey;
  await page.unroute(nodeRoute);

  const queuedRaw = await page.evaluate(() => { const value = localStorage.getItem("creative-curator:pending-project-edits:v1")!; localStorage.removeItem("creative-curator:pending-project-edits:v1"); return value; });
  const peer = await page.context().newPage(); await peer.goto(page.url()); await peer.locator(".react-flow__node").first().click();
  await peer.getByLabel("Node title").fill("Server latest title"); const peerSave = peer.waitForResponse(nodeRoute); await peer.getByRole("button", { name: "Save node" }).click();
  const peerResponse = await peerSave; expect(peerResponse.ok()).toBe(true); const savedByPeer = await peerResponse.json(); await peer.close();
  await page.evaluate((value) => localStorage.setItem("creative-curator:pending-project-edits:v1", value), queuedRaw);
  const latest = { nodeVersion: savedByPeer.version as number, projectVersion: queued[0].expectedVersion + 1 };
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const panel = page.getByRole("alertdialog", { name: "Version conflict" });
  await expect(panel).toBeVisible(); await expect(panel.getByText("Submitted keep-mine title")).toBeVisible(); await expect(panel.getByText("Server latest title")).toBeVisible();
  const pendingBefore = await page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"));
  let retryCount = 0; let retryBody: Record<string, unknown> | null = null; let retryKey = "";
  await page.route(nodeRoute, async (route) => {
    retryCount += 1;
    if (retryCount === 1) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "store_unavailable" } }) }); return; }
    retryBody = route.request().postDataJSON() as Record<string, unknown>; retryKey = route.request().headers()["idempotency-key"] ?? ""; await route.continue();
  });
  await panel.getByRole("button", { name: "Compare versions" }).click();
  expect(retryCount).toBe(0); expect(await page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBe(pendingBefore);
  await panel.getByRole("button", { name: "Keep mine" }).click(); await panel.getByRole("button", { name: "Confirm keep mine" }).click();
  await expect(panel.getByRole("alert")).toContainText("Retry failed");
  expect(await page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBe(pendingBefore);
  await expect(page.getByLabel("Node title")).toHaveValue("Submitted keep-mine title"); expect(await page.locator(".react-flow__viewport").getAttribute("style")).toBe(viewportBefore);
  await panel.getByRole("button", { name: "Confirm keep mine" }).click();
  await expect(panel).toHaveCount(0); await expect.poll(() => page.evaluate(() => localStorage.getItem("creative-curator:pending-project-edits:v1"))).toBeNull();
  expect(retryBody).toMatchObject({ expected_node_version: latest.nodeVersion, expected_project_version: latest.projectVersion });
  expect(retryKey).not.toBe(oldKey); expect(retryKey).not.toBe("");
  await expect(page.getByLabel("Node title")).toHaveValue("Submitted keep-mine title"); await expect(page.getByLabel("Node title")).toBeFocused();
  expect(await page.locator(".react-flow__viewport").getAttribute("style")).toBe(viewportBefore);
});

test("canvas exposes keyboard focus, mode shortcuts, zoom, and partial multiselection", async ({ page }) => {
  await createProject(page);
  const canvas = page.getByTestId("constellation-canvas");
  const beforePan = await page.locator(".react-flow__viewport").getAttribute("style");
  await canvas.hover();
  await page.mouse.wheel(80, 120);
  await expect.poll(() => page.locator(".react-flow__viewport").getAttribute("style")).not.toBe(beforePan);
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await page.keyboard.press("d");
  await expect(page.getByRole("button", { name: "Draw" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  const nodes = page.locator(".react-flow__node");
  await nodes.nth(0).click();
  const beforeKeyboard = await nodes.nth(0).boundingBox();
  const keyboardLayout = page.waitForRequest(/\/api\/projects\/[^/]+\/layout$/);
  await nodes.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  expect((await keyboardLayout).method()).toBe("PUT");
  const afterKeyboard = await nodes.nth(0).boundingBox();
  expect(afterKeyboard!.x).toBeGreaterThan(beforeKeyboard!.x);
  const resizeHandle = page.locator(".react-flow__resize-control.handle").last();
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  const resizeRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/layout$/);
  await page.mouse.move(resizeBox!.x + 2, resizeBox!.y + 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + 30, resizeBox!.y + 20);
  await page.mouse.up();
  expect((await resizeRequest).method()).toBe("PUT");
  const resized = await nodes.nth(0).boundingBox();
  await nodes.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("button", { name: "Connect" }).click();
  const edgeRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/edges$/);
  await page.getByLabel("Outgoing relationships").first().dragTo(page.getByLabel("Incoming relationships").nth(1));
  expect((await edgeRequest).method()).toBe("POST");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  const reloadedSize = await page.locator(".react-flow__node").nth(0).boundingBox();
  expect(reloadedSize!.width).toBeCloseTo(resized!.width, 0);
  expect(reloadedSize!.height).toBeCloseTo(resized!.height, 0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("compact toolbar stays contained, accessible, and theme-stable", async ({ page }) => {
  await createProject(page);
  const toolbar = page.getByRole("toolbar", { name: "Canvas tools" });
  const names = ["Select", "Connect", "Draw", "Erase", "Add thought", "Add media", "Undo", "Redo"];
  const buttons = toolbar.getByRole("button");
  await expect(buttons).toHaveCount(names.length);
  await expect(toolbar.locator(".canvas-toolbar__divider")).toHaveCount(2);
  for (const [index, name] of names.entries()) await expect(buttons.nth(index)).toHaveAccessibleName(name);
  expect(await toolbar.locator(":scope > *").evaluateAll((children) => children.map((child) =>
    child instanceof HTMLButtonElement ? child.getAttribute("aria-label") : child.className,
  ))).toEqual(["Select", "Connect", "Draw", "Erase", "canvas-toolbar__divider", "Add thought", "Add media", "canvas-toolbar__divider", "Undo", "Redo"]);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 961, height: 768 },
    { width: 960, height: 768 },
    { width: 930, height: 768 },
    { width: 901, height: 768 },
  ]) {
    let viewportBaseline: { toolbar: number[]; buttons: number[][]; dividers: number[][]; gaps: number[] } | null = null;
    await page.setViewportSize(viewport);
    const menu = page.locator(".theme-selector__menu");
    if (!await menu.isVisible()) await page.getByRole("button", { name: "Theme", exact: true }).click();
    for (const theme of ["paper", "graphite", "project"] as const) {
      await menu.locator("select").first().selectOption(theme);
      await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-theme", theme);
      const geometry = await toolbar.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const box = (child: Element) => { const value = child.getBoundingClientRect(); return [value.x, value.y, value.width, value.height]; };
        const relativeBox = (child: Element) => { const value = child.getBoundingClientRect(); return [value.x - rect.x, value.y - rect.y, value.width, value.height].map((part) => Math.round(part * 100) / 100); };
        const children = [...element.children];
        return {
          toolbar: [rect.x, rect.y, rect.width, rect.height],
          buttons: [...element.querySelectorAll("button")].map(box),
          signature: {
            toolbar: [rect.width, rect.height].map((part) => Math.round(part * 100) / 100),
            buttons: [...element.querySelectorAll("button")].map(relativeBox),
            dividers: [...element.querySelectorAll(".canvas-toolbar__divider")].map(relativeBox),
            gaps: children.slice(1).map((child, index) => Math.round((child.getBoundingClientRect().x - children[index].getBoundingClientRect().right) * 100) / 100),
          },
          canvas: box(element.parentElement!),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      });
      expect(geometry.toolbar[0], `${theme} at ${viewport.width}px left`).toBeGreaterThanOrEqual(geometry.canvas[0]);
      expect(geometry.toolbar[0] + geometry.toolbar[2], `${theme} at ${viewport.width}px right`).toBeLessThanOrEqual(geometry.canvas[0] + geometry.canvas[2]);
      expect(geometry.toolbar[0] + geometry.toolbar[2]).toBeLessThanOrEqual(viewport.width);
      expect(geometry.scrollWidth).toBe(geometry.clientWidth);
      for (const [, , width, height] of geometry.buttons) { expect(width).toBe(44); expect(height).toBe(44); }
      if (!viewportBaseline) viewportBaseline = geometry.signature;
      else expect(geometry.signature, `${theme} geometry at ${viewport.width}px`).toEqual(viewportBaseline);
    }
    await page.getByRole("button", { name: "Close theme preferences" }).click();
  }

  await expect(toolbar.getByRole("tooltip")).toHaveCount(0);
  await expect(toolbar.locator("button")).toHaveText(["", "", "", "", "", "", "", ""]);
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(toolbar.getByRole("button", { name: "Redo" })).toBeDisabled();
  await toolbar.getByRole("button", { name: "Add thought" }).click();
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "Redo" })).toBeDisabled();
  await toolbar.getByRole("button", { name: "Add thought" }).click();
  await toolbar.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toHaveCount(1);
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "Redo" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeFocused();
  await toolbar.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".react-flow__node").getByText("New thought", { exact: true })).toHaveCount(2);
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "Redo" })).toBeDisabled();
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeFocused();
  await expect(toolbar.getByRole("tooltip", { name: "Redo" })).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Undo" }).click();
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "Redo" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeFocused();
  await expect(toolbar.getByRole("tooltip", { name: "Redo" })).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const theme of ["paper", "graphite", "project"] as const) {
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    await page.locator(".theme-selector__menu select").first().selectOption(theme);
    await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Close theme preferences" }).click();
    await page.getByTestId("constellation-canvas").focus();
    await expect(toolbar.getByRole("tooltip")).toHaveCount(0);
    for (const name of names) {
      const button = toolbar.getByRole("button", { name, exact: true });
      const resting = await button.evaluate((element) => { const style = getComputedStyle(element); return [style.backgroundColor, style.color]; });
      await button.hover();
      const tooltip = toolbar.getByRole("tooltip", { name });
      await expect(tooltip).toBeVisible();
      const hovered = await button.evaluate((element) => { const style = getComputedStyle(element); return [style.backgroundColor, style.color]; });
      expect(hovered[0]).not.toBe("rgba(0, 0, 0, 0)");
      if (name !== "Select") expect(hovered, `${theme} ${name} hover style`).not.toEqual(resting);
      const tooltipColors = await tooltip.evaluate((element) => { const style = getComputedStyle(element); return { foreground: style.color, background: style.backgroundColor }; });
      const tooltipContrast = opaqueContrastRatio(tooltipColors.foreground, tooltipColors.background);
      expect(tooltipContrast, `${theme} ${name} tooltip contrast`).toBeGreaterThanOrEqual(4.5);
      await page.mouse.move(0, 0);
      await expect(tooltip).toHaveCount(0);
    }

    await toolbar.getByRole("button", { name: "Select", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    for (const name of names) {
      const button = toolbar.getByRole("button", { name, exact: true });
      await expect(button).toBeFocused();
      const focusIndicator = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.outlineColor, surface: getComputedStyle(element.parentElement!).backgroundColor, style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(focusIndicator.style).toBe("solid");
      expect(focusIndicator.width).toBeGreaterThanOrEqual(3);
      expect(opaqueContrastRatio(focusIndicator.color, focusIndicator.surface), `${theme} ${name} focus contrast`).toBeGreaterThanOrEqual(3);
      await expect(toolbar.getByRole("tooltip", { name })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(toolbar.getByRole("tooltip", { name })).toHaveCount(0);
      await expect(button).toBeFocused();
      if (name !== "Redo") await page.keyboard.press("Tab");
    }
  }
});

test("media stays in private annotation persistence", async ({ page }) => {
  await createProject(page);
  const annotationBodies: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (/\/api\/projects\/[^/]+\/annotations$/.test(new URL(request.url()).pathname)) annotationBodies.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.getByLabel("Choose media").setInputFiles({
    name: "reference.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByRole("img", { name: "Canvas media 1" })).toBeVisible();
  await expect.poll(() => annotationBodies.length).toBe(1);
  const body = JSON.stringify(annotationBodies[0]);
  expect(body).toContain('"annotation_type":"media"');
  expect(body).toContain('"media_id"');
  expect(body).not.toContain("data:image");
});

test("media failures remain actionable and never claim annotations saved", async ({ page }) => {
  const image = { name: "retry.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };
  await createProject(page);
  await page.route(/\/api\/projects\/[^/]+\/media$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.getByLabel("Choose media").setInputFiles(image);
  await expect(page.getByText("Annotations need attention")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Media upload failed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry media upload" })).toBeVisible();

  await page.route(/\/api\/projects\/[^/]+\/annotations$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.getByRole("button", { name: "Retry media upload" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Media placement was not saved" })).toBeVisible();
  await expect(page.getByText("Annotations need attention")).toBeVisible();
});

test("failed media cleanup exposes recovery action", async ({ page }) => {
  const image = { name: "cleanup.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };
  await createProject(page);
  await page.route(/\/api\/projects\/[^/]+\/annotations$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.route(/\/api\/projects\/[^/]+\/media\/[^/]+$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.getByLabel("Choose media").setInputFiles(image);
  await expect(page.getByRole("alert").filter({ hasText: "Uploaded media cleanup failed" })).toBeVisible();
  await page.getByRole("button", { name: "Retry media cleanup" }).click();
  await expect(page.getByRole("button", { name: "Retry media upload" })).toBeVisible();
  await expect(page.getByText("Annotations need attention")).toBeVisible();
});

test("semantic queue serializes rapid actions and rolls back failed nodes and edges", async ({ page }) => {
  await createProject(page);
  await page.getByRole("button", { name: "Add thought" }).click();
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  const thoughts = page.locator(".react-flow__node").filter({ hasText: "New thought" });
  await expect(thoughts).toHaveCount(2);
  await page.reload();
  await expect(thoughts).toHaveCount(2);

  await page.route(/\/api\/projects\/[^/]+\/nodes$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "New thought was not saved" })).toBeVisible();
  await expect(page.getByText("Graph needs attention")).toBeVisible();
  await expect(thoughts).toHaveCount(2);

  await page.route(/\/api\/projects\/[^/]+\/edges$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByLabel("Outgoing relationships").first().dragTo(page.getByLabel("Incoming relationships").nth(1));
  await expect(page.getByRole("alert").filter({ hasText: "Relationship was not saved" })).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});

test("quick capture uses no provider and inspector preserves precise server history", async ({ page }) => {
  await createProject(page);
  let analysisCalls = 0; page.on("request", (request) => { if (/\/analysis$/.test(new URL(request.url()).pathname)) analysisCalls += 1; });
  await page.getByLabel("Thought title").fill("Quiet confidence");
  await page.getByLabel("Thought details").fill("Make claims proportionate to proof");
  await page.getByRole("button", { name: "Capture thought" }).click();
  await expect(page.getByText("Quiet confidence")).toBeVisible(); expect(analysisCalls).toBe(0);
  await page.locator(".react-flow__node").filter({ hasText: "Quiet confidence" }).click();
  const inspector = page.getByRole("region", { name: "Node inspector" });
  await expect(inspector).toBeVisible(); await inspector.getByLabel("Node title").fill("Measured confidence");
  await inspector.getByLabel("Node type").selectOption("decision"); const nodeSave = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/nodes\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH"); await inspector.getByRole("button", { name: "Save node" }).click(); expect((await nodeSave).ok()).toBe(true); await expect(inspector.getByText("Quiet confidence")).toBeVisible();
  await page.route(/\/api\/projects\/[^/]+\/nodes$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  await page.getByLabel("Thought title").fill("Draft survives"); await page.getByLabel("Thought details").fill("Keep exact wording"); await page.getByRole("button", { name: "Capture thought" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Draft preserved" })).toBeVisible(); await expect(page.getByLabel("Thought title")).toHaveValue("Draft survives");
});

test("guided analysis preserves request, previews proposals, and reloads stale acceptance", async ({ page }) => {
  await createProject(page); const node = page.locator(".react-flow__node").first(); await node.click();
  await page.route(/\/api\/projects\/[^/]+\/analysis$/, (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: { code: "ai_configuration_required" } }) }), { times: 1 });
  await page.getByRole("button", { name: "Explore selected node" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Request preserved" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", /\/settings\?returnTo=/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("creative-curator:analysis-retry:")))).toBe(true);
  let retryCalls = 0; page.on("request", (request) => { if (/\/analysis$/.test(new URL(request.url()).pathname)) retryCalls += 1; });
  await page.getByRole("link", { name: "Open Settings" }).click(); await expect(page).toHaveURL(/\/settings\?returnTo=/);
  await expect(page.getByRole("link", { name: "Return to preserved analysis" })).toBeVisible(); expect(retryCalls).toBe(0);
  await page.getByRole("link", { name: "Return to preserved analysis" }).click(); await expect(page.getByText("Analysis request restored")).toBeVisible(); expect(retryCalls).toBe(0);

  await page.route(/\/api\/projects\/[^/]+\/analysis$/, async (route) => {
    const request = route.request().postDataJSON() as { selected_node_id: string }; const now = new Date().toISOString();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposal: { id: "10000000-0000-4000-8000-000000000001", project_id: "00000000-0000-4000-8000-000000000001", title: "Add proof", rationale: "Claim needs evidence", target_node_ids: [request.selected_node_id], canonical_hash: "hash", dependency_node_versions: [[request.selected_node_id, 1]], dependency_edge_versions: [], creation_source: "hermes", state: "pending", version: 1, created_at: now, updated_at: now }, candidate: { summary: "Add proof", affected_node_ids: [request.selected_node_id], proposed_nodes: [{ client_key: "proof", node_type: "evidence", title: "Customer proof", content: "Collect interviews", rationale: "Validate claim" }], proposed_edges: [{ source_key: "proof", target_key: request.selected_node_id, edge_type: "supports" }] } }) });
  });
  await page.getByRole("button", { name: "Explore selected node" }).click(); await expect(page.getByText("Preview · not approved")).toBeVisible();
  await expect(page.locator(".constellation-node[data-preview=true]")).toHaveCount(1); await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.route(/\/api\/projects\/[^/]+\/proposals\/[^/]+\/accept$/, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "version_conflict" } }) }), { times: 1 });
  await page.getByRole("button", { name: "Accept proposal" }).click(); await expect(page.getByRole("alert").filter({ hasText: "Latest version loaded" })).toBeVisible();
  await expect(page.getByText("Preview · not approved")).toBeVisible(); await page.route(/\/api\/projects\/[^/]+\/proposals\/[^/]+\/reject$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "rejected" }) })); await page.getByRole("button", { name: "Reject proposal" }).click(); await expect(page.getByText("Preview · not approved")).toHaveCount(0);
});

test("configured deterministic Hermes proposes and accepts a structured challenge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await configuredSettings(page, "structured-challenge@example.com");
  await createProject(page, false);
  await page.locator(".react-flow__node").filter({ hasText: "Calm language earns trust" }).click();
  const analysisResponse = page.waitForResponse(/\/api\/projects\/[^/]+\/analysis$/);
  await page.getByRole("button", { name: "Explore selected node" }).click();
  expect((await analysisResponse).ok()).toBe(true);
  await expect(page.getByText("Preview · not approved")).toBeVisible();
  const preview = page.locator(".constellation-node[data-preview=true]").filter({ hasText: "Test the selected assumption" });
  await expect(preview).toBeVisible();
  const layout = await preview.evaluate((previewNode) => {
    const selectedNode = document.querySelector<HTMLElement>(".constellation-node[data-selected]");
    const canvas = document.querySelector<HTMLElement>("[data-testid=constellation-canvas]");
    const workPanel = document.querySelector<HTMLElement>(".constellation-work-panel");
    if (!selectedNode || !canvas || !workPanel) throw new Error("Proposal layout surfaces are missing");
    const previewRect = previewNode.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const panelRect = workPanel.getBoundingClientRect();
    const intersectionArea = (left: DOMRect, right: DOMRect) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
      * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const canvasNodes = [...document.querySelectorAll<HTMLElement>(".constellation-node:not([data-preview])")];
    const maxCanvasOverlap = Math.max(0, ...canvasNodes.map((node) => {
      const nodeRect = node.getBoundingClientRect();
      return intersectionArea(previewRect, nodeRect) / Math.min(previewRect.width * previewRect.height, nodeRect.width * nodeRect.height);
    }));
    return {
      maxCanvasOverlap,
      panelOverlap: intersectionArea(previewRect, panelRect),
      previewInsideCanvas: previewRect.left >= canvasRect.left - 1 && previewRect.right <= canvasRect.right + 1,
      previewBeforePanel: previewRect.right <= panelRect.left + 1,
      selectedOverlap: intersectionArea(previewRect, selectedNode.getBoundingClientRect()),
      textContained: previewNode.scrollWidth <= previewNode.clientWidth,
    };
  });
  expect(layout.maxCanvasOverlap).toBeLessThanOrEqual(.02);
  expect(layout.panelOverlap).toBe(0);
  expect(layout.previewInsideCanvas).toBe(true);
  expect(layout.previewBeforePanel).toBe(true);
  expect(layout.selectedOverlap).toBe(0);
  expect(layout.textContained).toBe(true);
  const acceptResponse = page.waitForResponse(/\/api\/projects\/[^/]+\/proposals\/[^/]+\/accept$/);
  await page.getByRole("button", { name: "Accept proposal" }).click();
  expect((await acceptResponse).ok()).toBe(true);
  const accepted = page.locator(".react-flow__node").filter({ hasText: "Test the selected assumption" });
  await expect(accepted).toBeVisible(); await accepted.click();
  const challenge = page.getByRole("region", { name: "Active challenge" });
  await expect(challenge).toContainText("DependenciesAssumption");
  await expect(challenge).toContainText("78%");
  await expect(challenge).toContainText("Positioning and messaging may need revision.");
});

test("semantic mutations serialize across canvas, capture, edit, proposal, and resolution", async ({ page }) => {
  await configuredSettings(page, "semantic-queue@example.com"); await createProject(page, false);
  await page.locator(".react-flow__node").filter({ hasText: "Calm language earns trust" }).click();
  await page.getByRole("button", { name: "Explore selected node" }).click();
  await expect(page.getByText("Preview · not approved")).toBeVisible();

  const versions: number[] = []; const conflicts: string[] = []; let delayed = 0;
  page.on("response", (response) => { if (response.status() === 409 && /\/api\/projects\//.test(response.url())) conflicts.push(`${response.url()} ${response.request().postData()}`); });
  await page.route(/\/api\/projects\/[^/]+\/(nodes(?:\/[^/]+)?|proposals\/[^/]+\/accept|challenges\/[^/]+\/resolve)$/, async (route) => {
    const body = route.request().postDataJSON() as { expected_project_version?: number } | null;
    if (typeof body?.expected_project_version === "number") versions.push(body.expected_project_version);
    if (delayed < 3) { delayed += 1; await new Promise((resolve) => setTimeout(resolve, 180)); }
    await route.continue();
  });

  await page.getByRole("button", { name: "Add thought" }).click();
  await page.getByLabel("Thought title").fill("Queued capture"); await page.getByLabel("Thought details").fill("Exact draft survives queueing");
  await page.getByRole("button", { name: "Capture thought" }).click();
  await expect(page.locator(".react-flow__node").filter({ hasText: "Queued capture" })).toBeVisible(); await expect(page.getByText("Graph saved")).toBeVisible();

  await page.locator(".react-flow__node").filter({ hasText: "Customers move under time pressure" }).locator("article").dispatchEvent("click");
  const inspector = page.getByRole("region", { name: "Node inspector" });
  await inspector.getByLabel("Node title").fill("Edited known fact");
  const acceptance = page.waitForResponse(/\/api\/projects\/[^/]+\/proposals\/[^/]+\/accept$/); const editResponse = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/nodes\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH"); await page.getByRole("button", { name: "Accept proposal" }).click(); await inspector.getByRole("button", { name: "Save node" }).click();
  const acceptanceResponse = await acceptance; expect(acceptanceResponse.status(), JSON.stringify(versions)).toBe(200);
  expect((await editResponse).status(), JSON.stringify(versions)).toBe(200);
  await expect(page.getByText("Preview · not approved")).toHaveCount(0);
  const accepted = page.locator('.react-flow__node:not([data-id^="preview:"])').filter({ hasText: "Test the selected assumption" }); await expect(accepted).toBeVisible();
  await expect(page.locator(".react-flow__node").filter({ hasText: "Edited known fact" })).toBeVisible(); await accepted.locator("article").dispatchEvent("click");

  await page.getByLabel("Resolution note").fill("Resolve after queued canvas mutation");
  await page.getByRole("button", { name: "Add thought" }).click(); await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resolved challenge" })).toContainText("Resolve after queued canvas mutation");
  expect(conflicts).toEqual([]); expect(versions.length).toBeGreaterThanOrEqual(6);
  expect(versions.every((value, index) => index === 0 || value === versions[index - 1] + 1)).toBe(true);
  await expect(page.getByLabel("Thought title")).toHaveValue("");
});

test("challenge override requires note and announces history link", async ({ page }) => {
  await createProject(page); await page.locator(".react-flow__node").first().click(); const inspector = page.getByRole("region", { name: "Node inspector" });
  await inspector.getByLabel("Node type").selectOption("challenge"); await inspector.getByRole("button", { name: "Save node" }).click();
  await expect(page.getByRole("region", { name: "Active challenge" })).toBeVisible();
  await page.getByRole("button", { name: "Override" }).click(); await expect(page.getByRole("alert").filter({ hasText: "note is required" })).toBeVisible();
  await page.getByLabel("Resolution note").fill("Accepted risk"); await page.getByRole("button", { name: "Override" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Challenge overridden" })).toBeVisible(); await expect(page.getByRole("link", { name: "View resolution history" })).toBeVisible();
  await page.reload(); await page.locator(".react-flow__node").first().click(); await expect(page.getByRole("region", { name: "Resolved challenge" })).toContainText("Accepted risk"); await expect(page.getByRole("button", { name: "Override" })).toHaveCount(0);
  const resolvedInspector = page.getByRole("region", { name: "Node inspector" }); await resolvedInspector.getByLabel("Node type").selectOption("idea"); await resolvedInspector.getByRole("button", { name: "Save node" }).click();
  await expect(page.getByRole("region", { name: "Challenge resolution archive" })).toContainText("Accepted risk");
  await page.reload(); await page.locator(".react-flow__node").first().click(); await expect(page.getByRole("region", { name: "Challenge resolution archive" })).toContainText("Accepted risk");
});

test("layout, annotation, and media failures report owning domain and compensate uploads", async ({ page }) => {
  await createProject(page);
  await page.route(/\/api\/projects\/[^/]+\/layout$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 1 });
  const node = page.locator(".react-flow__node").first();
  await node.dragTo(page.getByTestId("constellation-canvas"), { targetPosition: { x: 500, y: 300 } });
  await expect(page.getByText("Layout needs attention")).toBeVisible();

  await page.route(/\/api\/projects\/[^/]+\/annotations$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "project_store_unavailable" } }) }), { times: 2 });
  const canvas = page.getByTestId("constellation-canvas");
  await page.getByRole("button", { name: "Draw" }).click();
  await canvas.dispatchEvent("pointerdown", { clientX: 500, clientY: 320, pointerId: 1, buttons: 1 });
  await canvas.dispatchEvent("pointermove", { clientX: 540, clientY: 340, pointerId: 1, buttons: 1 });
  await canvas.dispatchEvent("pointerup", { clientX: 540, clientY: 340, pointerId: 1 });
  await expect(page.getByText("Annotations need attention")).toBeVisible();

  let deleteRequests = 0;
  page.on("request", (request) => { if (request.method() === "DELETE" && /\/media\//.test(request.url())) deleteRequests += 1; });
  await page.getByLabel("Choose media").setInputFiles({ name: "failed.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  await expect.poll(() => deleteRequests).toBe(1);
  await expect(page.getByRole("img", { name: "Canvas media 1" })).toHaveCount(0);
});

test("browser history storage denial never rolls back successful graph mutations", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("creative-curator:workspace-history:v1:")) throw new DOMException("storage denied", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await createProject(page);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Undo history remains available only until this tab closes" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await expect(page.locator(".react-flow__node").getByText("New thought")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  await expect(page.getByText("New thought")).toBeVisible();
});

test("viewport storage denial never blocks mount or movement", async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem; const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) { if (key.startsWith("creative-curator:viewport:")) throw new DOMException("denied", "SecurityError"); return get.call(this, key); };
    Storage.prototype.setItem = function (key: string, value: string) { if (key.startsWith("creative-curator:viewport:")) throw new DOMException("full", "QuotaExceededError"); return set.call(this, key, value); };
  });
  await createProject(page);
  await expect(page.getByTestId("constellation-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("Layout saved")).toBeVisible();
});

test("structured graph is a keyboard-operable equivalent with explicit semantics", async ({ page }) => {
  await createProject(page);
  await page.locator(".react-flow__node").filter({ hasText: "Customers move under time pressure" }).click();
  await page.getByRole("button", { name: "Structured graph" }).click();
  const graph = page.getByRole("region", { name: "Structured graph" });
  await expect(graph.getByRole("heading", { name: "Graph outline" })).toBeVisible();
  await expect(graph.getByText("Type: Evidence")).toBeVisible();
  await expect(graph.getByText("State: Working").first()).toBeVisible();

  const knownFact = graph.getByRole("button", { name: "Select Known fact" });
  await expect(knownFact).toBeFocused();
  await expect(page.getByRole("region", { name: "Node inspector" })).toBeVisible();

  let layoutWrites = 0;
  page.on("request", (request) => { if (/\/api\/projects\/[^/]+\/layout$/.test(new URL(request.url()).pathname)) layoutWrites += 1; });
  const layoutRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/layout$/);
  await graph.getByRole("button", { name: "Move Known fact right" }).focus();
  await page.keyboard.press("Enter");
  expect((await layoutRequest).method()).toBe("PUT");
  await expect(page.getByRole("status", { name: "Graph announcements" })).toContainText("Moved Known fact right");
  await page.waitForTimeout(500);
  expect(layoutWrites).toBe(1);

  await graph.getByLabel("Relationship target").selectOption({ label: "Assumption — Assumption" });
  const edgeRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/edges$/);
  await graph.getByRole("button", { name: "Create labeled relationship" }).focus();
  await page.keyboard.press("Enter");
  expect((await edgeRequest).method()).toBe("POST");
  await expect(graph.getByText(/Supports Assumption/)).toBeVisible();

  await graph.getByRole("button", { name: "Create thought" }).focus();
  await page.keyboard.press("Enter");
  await expect(graph.getByRole("button", { name: "Select New thought" })).toBeVisible();
  await page.getByRole("button", { name: "Canvas graph" }).click();
  await expect(page.locator(".react-flow__node").filter({ hasText: "New thought" })).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id]').filter({ hasText: "Known fact" })).toBeFocused();
});

test("reduced motion keeps structured graph transitions nonessential", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createProject(page);
  await page.getByRole("button", { name: "Structured graph" }).click();
  const duration = await page.getByRole("region", { name: "Structured graph" }).evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(["0s", "0.00001s", "1e-05s"]).toContain(duration);
});
