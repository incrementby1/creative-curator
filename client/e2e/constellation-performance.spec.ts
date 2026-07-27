import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

type ViewportTransform = { x: number; y: number; zoom: number };

async function viewportTransform(locator: ReturnType<import("@playwright/test").Page["locator"]>): Promise<ViewportTransform> {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

function expectClose(actual: number, expected: number, tolerance = 2) {
  expect(Math.abs(actual - expected), `${actual} should be within ${tolerance}px of ${expected}`).toBeLessThanOrEqual(tolerance);
}

test("real constellation renders 250 visible nodes, 400 edges, and aligned mixed annotations within budgets", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  test.skip(browserName !== "chromium", "Performance budget calibrated for bundled headless Chromium.");
  const relevantBrowserProblems: string[] = [];
  page.on("pageerror", (error) => relevantBrowserProblems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()) && /key|edge|react flow|exception|error/i.test(message.text())) relevantBrowserProblems.push(`${message.type()}: ${message.text()}`);
  });
  await signInForTest(page, "/projects/performance-fixture", "performance@example.com");
  const now = "2026-07-27T00:00:00Z";
  const nodes = Array.from({ length: 250 }, (_, index) => ({ id: `node-${index}`, project_id: "performance-fixture", node_type: index % 5 === 0 ? "evidence" : "idea", title: `Performance node ${index}`, content: `Bounded node content ${index}`, state: "working", created_by: "user", provenance: "performance fixture", tags: [`cluster:${Math.floor(index / 25)}`], version: 1, created_at: now, updated_at: now }));
  const edges = Array.from({ length: 400 }, (_, index) => ({ id: `edge-${index}`, project_id: "performance-fixture", source_node_id: `node-${index % 250}`, target_node_id: `node-${(index * 7 + 1) % 250}`, edge_type: "supports", label: null, version: 1, created_at: now, updated_at: now }));
  const annotations = Array.from({ length: 30 }, (_, index) => ({ id: `annotation-${index}`, project_id: "performance-fixture", owner_id: "performance-owner", annotation_type: index < 15 ? "freehand" : "media", path_points: index < 15 ? [[index * 40, index * 20], [index * 40 + 24, index * 20 + 18]] : [], color: index < 15 ? "#923f24" : null, media_id: index < 15 ? null : `media-${index}`, version: 1, created_at: now, updated_at: now }));
  const layout = Object.fromEntries(nodes.map((node, index) => [node.id, [(index % 25) * 280, Math.floor(index / 25) * 180]]));
  await page.route("**/api/projects/performance-fixture", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project: { id: "performance-fixture", owner_id: "performance-owner", title: "Performance fixture", status: "active", theme: "paper", version: 1, created_at: now, updated_at: now }, nodes, edges, layout_version: 0, layout, layout_dimensions: {}, annotation_version: 1, annotations, theme: "paper", global_theme: "paper", project_theme: null }) }));
  await page.route(/\/api\/projects\/performance-fixture\/media\/media-\d+$/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") }));
  const started = Date.now(); await page.goto("/projects/performance-fixture");
  await expect(page.locator(".react-flow__node")).toHaveCount(10, { timeout: 10_000 });
  expect(await page.locator(".react-flow__edge").count()).toBeLessThan(400); await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(15); await expect(page.locator(".media-annotation img")).toHaveCount(15);
  const collapsedRenderMs = Date.now() - started; await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-collapse-distant-clusters", "true"); await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-simplify-distant-nodes", "true");
  const expandedStarted = Date.now(); await page.getByRole("button", { name: "Expand distant clusters" }).click(); await expect(page.locator(".react-flow__node")).toHaveCount(250); await expect(page.locator(".react-flow__edge")).toHaveCount(400); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); const expandedRenderMs = Date.now() - expandedStarted;
  await expect(page.locator('.react-flow__edge[data-id="edge-0"]')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[data-id="edge-250"]')).toHaveCount(1);
  const firstFlowNode = page.locator('.react-flow__node[data-id="node-50"]');
  await firstFlowNode.focus(); await page.keyboard.press("Enter");
  const semanticNode = firstFlowNode.locator(".constellation-node");
  const semanticRenderBefore = await semanticNode.getAttribute("data-render-count");
  const positionBefore = await firstFlowNode.boundingBox();
  if (!positionBefore) throw new Error("Performance node has no initial layout box");
  await page.mouse.move(positionBefore.x + 40, positionBefore.y + 40); await page.mouse.down();
  await page.mouse.move(positionBefore.x + 140, positionBefore.y + 120, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await firstFlowNode.boundingBox())?.x).not.toBe(positionBefore.x);
  await expect(page.getByRole("heading", { name: "Size & position" })).toBeVisible();
  await page.getByLabel("Node width").fill("320"); await page.getByLabel("Node height").fill("180");
  await page.getByRole("button", { name: "Apply node size" }).focus(); await page.keyboard.press("Enter");
  await expect.poll(async () => (await firstFlowNode.boundingBox())?.width ?? 0).toBeGreaterThan(positionBefore.width + 20);
  expect(await semanticNode.getAttribute("data-render-count")).toBe(semanticRenderBefore);
  await page.getByRole("button", { name: "Collapse distant clusters" }).click(); await expect(page.locator(".react-flow__node")).toHaveCount(11); expect(await page.locator(".react-flow__edge").count()).toBeLessThan(400);

  const viewport = page.locator(".react-flow__viewport"); const viewportBefore = await viewport.getAttribute("style");
  const canvas = page.locator("[data-testid=constellation-canvas]"); const canvasBox = await canvas.boundingBox();
  const annotationPath = page.locator("[data-annotation-layer=true] path").first();
  const annotationGroup = page.locator("[data-annotation-layer=true] g");
  const mediaLayer = page.locator(".media-annotation-layer"); const mediaImage = page.locator(".media-annotation img").first();
  const annotationFlowBox = await annotationPath.evaluate((element) => { const box = (element as SVGGraphicsElement).getBBox(); return { x: box.x, y: box.y, width: box.width, height: box.height }; });
  const interactionStarted = Date.now(); await page.getByRole("button", { name: "Zoom in" }).click(); await expect.poll(() => viewport.getAttribute("style")).not.toBe(viewportBefore); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); const interactionMs = Date.now() - interactionStarted;
  const flowTransform = await viewportTransform(viewport); const annotationTransform = await viewportTransform(annotationGroup); const mediaTransform = await viewportTransform(mediaLayer);
  const annotationAfter = await annotationPath.boundingBox(); const mediaAfter = await mediaImage.boundingBox();
  expect(expandedRenderMs, `expanded render ${expandedRenderMs}ms`).toBeLessThan(5_000); expect(collapsedRenderMs, `collapsed render ${collapsedRenderMs}ms`).toBeLessThan(5_000); expect(interactionMs, `interaction ${interactionMs}ms`).toBeLessThan(1_000);
  expect(annotationTransform).toEqual(flowTransform); expect(mediaTransform).toEqual(flowTransform);
  if (!canvasBox || !annotationAfter || !mediaAfter) throw new Error("Mixed annotation fixture has no rendered geometry");
  expectClose(annotationAfter.x, canvasBox.x + flowTransform.x + annotationFlowBox.x * flowTransform.zoom);
  expectClose(annotationAfter.y, canvasBox.y + flowTransform.y + annotationFlowBox.y * flowTransform.zoom);
  expectClose(annotationAfter.width, annotationFlowBox.width * flowTransform.zoom);
  expectClose(annotationAfter.height, annotationFlowBox.height * flowTransform.zoom);
  expectClose(mediaAfter.x, canvasBox.x + flowTransform.x + 80 * flowTransform.zoom);
  expectClose(mediaAfter.y, canvasBox.y + flowTransform.y + 110 * flowTransform.zoom);
  expectClose(mediaAfter.width, 180 * flowTransform.zoom); expectClose(mediaAfter.height, 128 * flowTransform.zoom);
  expect(await semanticNode.getAttribute("data-render-count")).toBe(semanticRenderBefore);
  await expect(page.locator(".constellation-node__content > p:not(.constellation-node__preview)").first()).toBeHidden();
  expect(relevantBrowserProblems).toEqual([]);
  console.info(`CONSTELLATION_PERF Chromium/${process.platform} expanded=${expandedRenderMs}ms collapsed=${collapsedRenderMs}ms interaction=${interactionMs}ms nodes=250 edges=400 freehand=15 media=15`);
  test.info().annotations.push({ type: "performance", description: `Chromium/${process.platform} real React Flow fixture: expanded=${expandedRenderMs}ms collapsed=${collapsedRenderMs}ms interaction=${interactionMs}ms` });
});
