import { expect, test } from "@playwright/test";
import { signInForTest } from "./helpers/session";

async function createProject(page: import("@playwright/test").Page) {
  await signInForTest(page, "/projects/new", "constellation@example.com");
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
  await page.getByRole("button", { name: "Undo graph" }).click();
  await expect(page.getByText("New thought")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo graph" }).click();
  await expect(page.getByText("New thought")).toBeVisible();
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
  const resizeHandle = page.locator(".react-flow__resize-control.handle").last();
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  const resizeRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/layout$/);
  await page.mouse.move(resizeBox!.x + 2, resizeBox!.y + 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + 30, resizeBox!.y + 20);
  await page.mouse.up();
  expect((await resizeRequest).method()).toBe("PUT");
  await nodes.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("button", { name: "Connect" }).click();
  const edgeRequest = page.waitForRequest(/\/api\/projects\/[^/]+\/edges$/);
  await page.getByLabel("Outgoing relationships").first().dragTo(page.getByLabel("Incoming relationships").nth(1));
  expect((await edgeRequest).method()).toBe("POST");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
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
