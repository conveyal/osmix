import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

async function loadMonaco(page: Page) {
  await page.getByRole("button", { name: "Open file" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /^OSM PBF/ }).click();
  await (await fileChooserPromise).setFiles(MONACO_PBF);
  await expect(page.getByRole("button", { name: "File info" })).toBeVisible({ timeout: 120_000 });
}

/** Mark the current map canvas, to check later that navigation kept the same map. */
async function markMapCanvas(page: Page) {
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
  await page.evaluate(() => {
    document.querySelector(".maplibregl-canvas")?.setAttribute("data-test-map", "first");
  });
}

const sameMapCanvas = (page: Page) =>
  expect(page.locator('.maplibregl-canvas[data-test-map="first"]')).toHaveCount(1);

test("Home introduces each page and links to it", async ({ page }) => {
  await page.goto("/");
  const home = page.getByRole("main", { name: "Osmix" });
  await expect(home).toBeVisible();
  for (const [name, path] of [
    ["Merge", "/merge"],
    ["Inspect", "/inspect"],
    ["Extract", "/extract"],
  ] as const) {
    const section = home.getByRole("region", { name });
    await expect(section.getByRole("link", { name: `Open ${name}` })).toHaveAttribute("href", path);
  }
  // Home has no sidebar trigger and no map tools; the sidebar and map are mounted below it.
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("button", { name: /sidebar/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open map search" })).toHaveCount(0);
  await markMapCanvas(page);

  await home.getByRole("link", { name: "Open Inspect" }).click();
  await expect(page).toHaveURL(/\/inspect$/);
  await expect(home).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open map search" })).toBeVisible();
  await expect(nav.getByRole("button", { name: /sidebar/i })).toBeVisible();
  await sameMapCanvas(page);

  // The brand goes back to Home. Unknown paths do too.
  await page.getByRole("link", { name: "Osmix home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/nowhere");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("main", { name: "Osmix" })).toBeVisible();
});

test("pages keep their datasets, the map and stored files across navigation", async ({ page }) => {
  await page.goto("/inspect");
  await markMapCanvas(page);
  await loadMonaco(page);
  const nav = page.getByRole("navigation");

  // Save it: stored files are shared by every page.
  await page.getByRole("button", { name: "Save dataset to storage" }).click();
  await expect
    .poll(() => page.evaluate(async () => (await window.osmWorker.listStoredOsm()).length))
    .toBe(1);

  // Merge opens the most recently used stored file as its base on its first visit, as its own
  // dataset: Inspect's stays loaded.
  await nav.getByRole("link", { name: "Merge" }).click();
  const baseSection = page
    .locator('[data-slot="sidebar-section"]')
    .filter({ hasText: "Base OSM — authoritative existing dataset" })
    .first();
  await expect(baseSection.locator('[data-slot="osm-input-file-name"]')).toHaveText("monaco.pbf", {
    timeout: 60_000,
  });
  await sameMapCanvas(page);
  // The routing tool stays in the toolbar, disabled outside Inspect.
  await expect(
    page.getByRole("button", { name: "Route between two points (in Inspect)" }),
  ).toBeDisabled();

  // Back on Inspect the dataset is still open, and Home lists what each page holds.
  await nav.getByRole("link", { name: "Inspect" }).click();
  await expect(page.getByRole("button", { name: "Clear dataset" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Route between two points" })).toBeEnabled();
  await sameMapCanvas(page);
  await page.getByRole("link", { name: "Osmix home" }).click();
  const home = page.getByRole("main", { name: "Osmix" });
  await expect(home.getByRole("region", { name: "Inspect" })).toContainText("Open now: monaco.pbf");
  await expect(home.getByRole("region", { name: "Merge" })).toContainText(
    "Open now: base monaco.pbf",
  );

  // `?load=<hash>` opens a stored file on a page whose slot is still empty.
  const [stored] = await page.evaluate(() => window.osmWorker.listStoredOsm());
  await page.goto(`/inspect?load=${stored?.fileHash}`);
  await expect(page.getByRole("button", { name: "Clear dataset" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page).toHaveURL(/\/inspect$/);
});
