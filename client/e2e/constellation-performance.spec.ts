import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

test("real constellation renders 250 visible nodes, 400 edges, and aligned mixed annotations within budgets", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  test.skip(browserName !== "chromium", "Performance budget calibrated for bundled headless Chromium.");
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
  const renderMs = Date.now() - started; await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-collapse-distant-clusters", "true"); await expect(page.locator(".constellation-workspace")).toHaveAttribute("data-simplify-distant-nodes", "true"); const annotationBefore = await page.locator("[data-annotation-layer=true] path").first().boundingBox(); const mediaBefore = await page.locator(".media-annotation img").first().boundingBox();
  await page.getByRole("button", { name: "Expand distant clusters" }).click(); await expect(page.locator(".react-flow__node")).toHaveCount(250); await page.getByRole("button", { name: "Collapse distant clusters" }).click(); await expect(page.locator(".react-flow__node")).toHaveCount(10);
  const semanticRenderBefore = await page.locator(".constellation-node").first().getAttribute("data-render-count");
  const viewport = page.locator(".react-flow__viewport"); const viewportBefore = await viewport.getAttribute("style");
  const interactionStarted = Date.now(); await page.getByRole("button", { name: "Zoom in" }).click(); await expect.poll(() => viewport.getAttribute("style")).not.toBe(viewportBefore); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); const interactionMs = Date.now() - interactionStarted;
  const annotationAfter = await page.locator("[data-annotation-layer=true] path").first().boundingBox(); const mediaAfter = await page.locator(".media-annotation img").first().boundingBox();
  expect(renderMs, `render ${renderMs}ms`).toBeLessThan(5_000); expect(interactionMs, `interaction ${interactionMs}ms`).toBeLessThan(1_000);
  expect(annotationAfter).not.toEqual(annotationBefore); expect(mediaAfter).not.toEqual(mediaBefore); await expect(page.locator(".constellation-node__content > p:not(.constellation-node__preview)").first()).toBeHidden();
  expect(await page.locator(".constellation-node").first().getAttribute("data-render-count")).toBe(semanticRenderBefore);
  console.info(`CONSTELLATION_PERF Chromium/${process.platform} render=${renderMs}ms interaction=${interactionMs}ms nodes=250 edges=400 freehand=15 media=15`);
  test.info().annotations.push({ type: "performance", description: `Chromium/${process.platform} real React Flow fixture: render=${renderMs}ms interaction=${interactionMs}ms` });
});
