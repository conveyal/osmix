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
  const loadFailure = page.getByRole("alert");
  await expect(fileInfo.or(loadFailure)).toBeVisible({ timeout: 120_000 });
  if (await loadFailure.isVisible()) {
    throw new Error(`OSM load failed: ${await loadFailure.innerText()}`);
  }
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  await page.getByRole("button", { name: "Find duplicate nodes and ways" }).click();
  await expect(page.getByText("Diagnostic candidates")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Summary", { exact: true })).toBeVisible();
});
