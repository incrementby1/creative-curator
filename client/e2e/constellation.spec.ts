import { expect, test } from "@playwright/test";
import { configuredSettings, signInForTest } from "./helpers/session";

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
  await page.getByRole("button", { name: "Undo graph" }).click(); await undoResponse;
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  await expect(page.getByText("New thought")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => { const projectId = location.pathname.split("/").pop(); const value = localStorage.getItem(`creative-curator:semantic-history:${projectId}`); return Boolean(value && JSON.parse(value).future?.length > 0); })).toBe(true);
  await page.waitForTimeout(100);
  const redoResponse = page.waitForResponse(/\/api\/projects\/[^/]+\/nodes\/[^/]+\/restore$/);
  await page.getByRole("button", { name: "Redo graph" }).click(); await redoResponse;
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

  await page.getByRole("button", { name: "Undo annotations" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
  await expect(page.getByText("Annotations saved")).toBeVisible();
  await page.getByRole("button", { name: "Redo annotations" }).click();
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(1);
  await page.getByRole("button", { name: "Erase" }).click();
  await page.locator("[data-annotation-layer=true] path").dispatchEvent("pointerdown", { pointerId: 2, buttons: 1 });
  await expect(page.locator("[data-annotation-layer=true] path")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo annotations" }).click();
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
  await page.getByRole("button", { name: "Undo graph" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo graph" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("keyboard controls connect and resize nodes without pointer handles", async ({ page }) => {
  await createProject(page);
  await page.getByRole("button", { name: "Keyboard graph controls" }).focus();
  await page.keyboard.press("Enter");
  const source = page.getByLabel("Connection source");
  await source.focus(); await page.keyboard.press("a"); await page.keyboard.press("Enter");
  await expect(source.locator("option:checked")).toHaveText("Assumption");
  const target = page.getByLabel("Connection target");
  await target.focus(); await page.keyboard.press("k"); await page.keyboard.press("Enter");
  await expect(target.locator("option:checked")).toHaveText("Known fact");
  const edgeRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/edges$/);
  await page.getByRole("button", { name: "Create relationship" }).focus(); await page.keyboard.press("Enter");
  expect((await edgeRequest).method()).toBe("POST");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const assumption = page.locator(".react-flow__node").filter({ hasText: "Calm language earns trust" });
  const before = await assumption.boundingBox();
  const resizeNode = page.getByLabel("Node to resize");
  await resizeNode.focus(); await page.keyboard.press("a"); await page.keyboard.press("Enter");
  await expect(resizeNode.locator("option:checked")).toHaveText("Assumption");
  await page.getByLabel("Node width").fill("400");
  const resizeRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/layout$/);
  await page.getByRole("button", { name: "Apply node size" }).focus(); await page.keyboard.press("Enter");
  expect((await resizeRequest).method()).toBe("PUT");
  await expect.poll(async () => (await assumption.boundingBox())!.width).toBeGreaterThan(before!.width + 30);
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
  await configuredSettings(page, "structured-challenge@example.com");
  await createProject(page, false);
  await page.locator(".react-flow__node").filter({ hasText: "Calm language earns trust" }).click();
  const analysisResponse = page.waitForResponse(/\/api\/projects\/[^/]+\/analysis$/);
  await page.getByRole("button", { name: "Explore selected node" }).click();
  expect((await analysisResponse).ok()).toBe(true);
  await expect(page.getByText("Preview · not approved")).toBeVisible();
  await expect(page.locator(".constellation-node[data-preview=true]").filter({ hasText: "Test the selected assumption" })).toBeVisible();
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
      if (key.startsWith("creative-curator:semantic-history:")) throw new DOMException("storage denied", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await createProject(page);
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Graph history remains available only until this tab closes" })).toBeVisible();
  await page.getByRole("button", { name: "Undo graph" }).click();
  await expect(page.getByText("Graph saved")).toBeVisible();
  await expect(page.getByText("New thought")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo graph" }).click();
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
