import { expect, test } from "@playwright/test";
import { configuredSettings, signInForTest } from "./helpers/session";

test.use({ viewport: { width: 390, height: 844 } });

async function createProject(page: import("@playwright/test").Page, configured = false) {
  if (configured) await configuredSettings(page, "mobile-constellation@example.com");
  else await signInForTest(page, "/projects/new", "mobile-constellation@example.com");
  if (configured) await page.goto("/projects/new");
  await page.getByLabel("Project name").fill("Mobile Northline");
  await page.getByLabel("Known facts").fill("Customers move under time pressure");
  await page.getByLabel("Assumptions").fill("Calm language earns trust");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Open Mobile Northline" }).click();
}

test("mobile focus mode traverses, edits, captures, and exposes full work flow", async ({ page }) => {
  await createProject(page);
  const navigator = page.getByRole("region", { name: "Mobile graph navigator" });
  await expect(navigator.getByRole("heading", { name: "Constellation overview" })).toBeVisible();
  await expect(navigator.getByText("Automatic layout active")).toBeVisible();
  await expect(page.getByTestId("constellation-canvas")).toBeHidden();
  await expect(page.getByRole("button", { name: "Draw" })).toBeHidden();

  await navigator.getByRole("button", { name: "Focus Known fact" }).click();
  const focusedHeading = navigator.getByRole("heading", { name: "Known fact" });
  await expect(focusedHeading).toBeFocused();
  await expect(navigator.getByRole("status", { name: "Mobile graph announcements" })).toHaveText(/Focused Known fact\. Type Evidence\. Node [12] of 2\. 0 neighboring relationships\./);
  await expect(navigator.getByText("Type: Evidence")).toBeVisible();
  const inspector = page.getByRole("region", { name: "Node inspector" });
  await expect(inspector).toBeVisible();
  await navigator.getByRole("button", { name: "Next node" }).click();
  await expect(navigator.getByRole("heading", { name: "Assumption" })).toBeFocused();
  await expect(navigator.getByRole("status", { name: "Mobile graph announcements" })).toHaveText(/Focused Assumption\. Type Assumption\. Node [12] of 2\./);
  await navigator.getByRole("button", { name: "Previous node" }).click();
  await expect(focusedHeading).toBeFocused();

  await inspector.getByLabel("Node title").fill("Mobile known fact");
  await inspector.getByLabel("State").selectOption("approved");
  await inspector.getByRole("button", { name: "Save node" }).click();
  await expect(inspector.getByText("Node saved")).toBeVisible();
  await inspector.getByLabel("Connection target").selectOption({ label: "Assumption" });
  await inspector.getByLabel("Relationship type").selectOption("contradicts");
  await inspector.getByRole("button", { name: "Add relationship" }).click();
  await expect(inspector.getByText("Relationship saved")).toBeVisible();
  const relation = navigator.getByRole("button", { name: /Outgoing: Contradicts\s+Assumption/ });
  await relation.click();
  await expect(navigator.getByRole("heading", { name: "Assumption" })).toBeFocused();
  await expect(navigator.getByRole("status", { name: "Mobile graph announcements" })).toHaveText(/Focused Assumption\. Type Assumption\. Node [12] of 2\. 1 neighboring relationship\./);

  await page.reload();
  await expect(navigator.getByRole("button", { name: "Focus Mobile known fact" })).toBeVisible();
  await navigator.getByRole("button", { name: "Focus Mobile known fact" }).click();
  await expect(page.getByRole("region", { name: "Node inspector" }).getByLabel("State")).toHaveValue("approved");
  await expect(navigator.getByRole("button", { name: /Outgoing: Contradicts\s+Assumption/ })).toBeVisible();

  await page.getByLabel("Thought title").fill("Mobile insight");
  await page.getByLabel("Thought details").fill("Captured without precision placement");
  await page.getByRole("button", { name: "Capture thought" }).click();
  await expect(navigator.getByRole("button", { name: "Focus Mobile insight" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore selected node" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Blueprint" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  const tooSmall = await page.locator(".constellation-workspace button, .constellation-workspace a, .constellation-workspace input, .constellation-workspace select, .constellation-workspace textarea").evaluateAll((items) => items.filter((item) => {
    const rect = item.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
  }).map((item) => ({ text: item.getAttribute("aria-label") || item.textContent, box: item.getBoundingClientRect().toJSON() })));
  expect(tooSmall).toEqual([]);
});

test("selection and semantic state survive desktop-mobile representation changes", async ({ page }) => {
  await createProject(page);
  await page.setViewportSize({ width: 1000, height: 844 });
  const canvasNode = page.locator(".react-flow__node").filter({ hasText: "Calm language earns trust" });
  await canvasNode.click();
  await page.setViewportSize({ width: 390, height: 844 });
  const navigator = page.getByRole("region", { name: "Mobile graph navigator" });
  await expect(navigator.getByRole("heading", { name: "Assumption" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Node inspector" }).getByLabel("Node title")).toHaveValue("Assumption");
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect(canvasNode).toHaveClass(/selected/);
  await expect(canvasNode).toBeFocused();
});

test("mobile completes Hermes challenge flow", async ({ page }) => {
  await createProject(page, true);
  const navigator = page.getByRole("region", { name: "Mobile graph navigator" });
  await navigator.getByRole("button", { name: "Focus Assumption" }).click();
  await page.getByRole("button", { name: "Explore selected node" }).click();
  await expect(page.getByText("Preview · not approved")).toBeVisible();
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await navigator.getByRole("button", { name: "Focus Test the selected assumption" }).click();
  await expect(page.getByRole("region", { name: "Active challenge" })).toBeVisible();
  await page.getByLabel("Resolution note").fill("Mobile review completed");
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resolved challenge" })).toContainText("Mobile review completed");
});
