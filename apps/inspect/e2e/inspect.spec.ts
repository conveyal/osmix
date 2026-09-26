import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

test("loads a PBF, renders the map, and runs duplicate diagnostics", async ({ page }) => {
  await page.goto("/");

  // The nav links to the sibling apps and marks this one as current.
  const nav = page.getByRole("navigation").or(page.locator("body"));
  await expect(nav.getByRole("link", { name: "Merge" })).toBeVisible();
  await expect(page.getByText("Inspect", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Open file" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /^OSM PBF/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(MONACO_PBF);

  const fileInfo = page.getByRole("button", { name: "File info" });
  // The in-page Alert, not the error toast that also announces as \`alert\`.
  const loadFailure = page.locator('[data-slot="alert"][role="alert"]');
  await expect(fileInfo.or(loadFailure)).toBeVisible({ timeout: 120_000 });
  if (await loadFailure.isVisible()) {
    throw new Error(`OSM load failed: ${await loadFailure.innerText()}`);
  }
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  // Search selects a way and hands focus to the inspector title. Picking one of its nodes from
  // the keyboard replaces the way's node list (and the focused button) with the node's view,
  // so the title must take focus again; Esc then returns to the search button that opened it.
  const searchToggle = page.getByRole("button", { name: "Open map search" });
  await searchToggle.click();
  await page.getByRole("textbox", { name: "Place or entity ID" }).fill("way/503633031");
  await page.keyboard.press("Enter");
  const inspectorTitle = page.locator('[data-slot="map-inspector-title"]');
  await expect(inspectorTitle).toHaveText("Way 503633031");
  await expect(inspectorTitle).toBeFocused();
  await page.getByRole("button", { name: /^Way nodes \(/ }).click();
  await page.keyboard.press("Tab");
  const selectNode = page.getByRole("button", { name: /^Select node \d+$/ }).first();
  await expect(selectNode).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(inspectorTitle).toHaveText(/^Node \d+$/);
  await expect(inspectorTitle).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inspectorTitle).toHaveCount(0);
  await expect(searchToggle).toBeFocused();

  await page.getByRole("button", { name: "Find duplicate nodes and ways" }).click();
  await expect(page.getByText("Diagnostic candidates")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Summary", { exact: true })).toBeVisible();
});
