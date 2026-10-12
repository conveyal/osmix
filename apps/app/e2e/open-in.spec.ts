import { fileURLToPath } from "node:url";

import { expect, type Page, test } from "@playwright/test";

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

async function chooseMonaco(page: Page) {
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /^OSM PBF/ }).click();
  await (await chooserPromise).setFiles(MONACO_PBF);
}

async function openIn(page: Page, target: string) {
  await page.getByRole("button", { name: "Open in" }).click();
  await page.getByRole("menuitem", { name: target }).click();
}

const inputFileName = (page: Page, title: string) =>
  page
    .locator('[data-slot="sidebar-section"]')
    .filter({ hasText: title })
    .first()
    .locator('[data-slot="osm-input-file-name"]');

test("datasets move between pages with Open in, without reloading", async ({ page }) => {
  // Inspect → Merge's base.
  await page.goto("/inspect");
  await chooseMonaco(page);
  await expect(page.getByRole("button", { name: "File info" })).toBeVisible({ timeout: 120_000 });
  await openIn(page, "Merge as base");
  await expect(page).toHaveURL(/\/merge$/);
  const base = inputFileName(page, "Base OSM — authoritative existing dataset");
  const patch = inputFileName(page, "Patch OSM — imported additions and updates");
  await expect(base).toHaveText("monaco.pbf");

  // The same file cannot also be the patch: nothing changes and Inspect stays open.
  await page.getByRole("navigation").getByRole("link", { name: "Inspect" }).click();
  await openIn(page, "Merge as patch");
  await expect(page.getByText("monaco.pbf is already loaded as the Base.").first()).toBeVisible();
  await expect(page).toHaveURL(/\/inspect$/);

  // Extract a box from the file, and send the extract to Merge as the patch. Monaco's turn
  // restrictions reference ways outside the file, so the tag filter keeps no relations.
  await page.getByRole("navigation").getByRole("link", { name: "Extract" }).click();
  await page.getByLabel("Paste bbox", { exact: false }).fill("7.415,43.73,7.425,43.74");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.getByRole("radio", { name: "Smart" }).check();
  await page.getByLabel("Relations tag value").fill("no-such-relation-type");
  await chooseMonaco(page);
  await page.getByRole("button", { name: "Extract", exact: true }).click();
  await expect(page.getByRole("table", { name: "Extract statistics" })).toBeVisible({
    timeout: 120_000,
  });
  await openIn(page, "Merge as patch");
  await expect(page).toHaveURL(/\/merge$/);
  await expect(base).toHaveText("monaco.pbf");
  await expect(patch).toHaveText("monaco-extract.pbf");

  // Merge them, then inspect the result. The extract's IDs name base entities, and a regional
  // cut would edit them into broken relations, so treat its features as new.
  await page.getByRole("checkbox", { name: "Treat every patch feature as new" }).check();
  await page.getByRole("button", { name: "Apply automatically" }).click();
  await expect(page.getByRole("button", { name: "Export merged PBF" })).toBeVisible({
    timeout: 120_000,
  });
  await openIn(page, "Inspect");
  await expect(page).toHaveURL(/\/inspect$/);
  const dataset = page
    .locator('[data-slot="sidebar-section"]')
    .filter({ hasText: "Dataset" })
    .first();
  await expect(dataset).toContainText("osmix-merged");

  // Inspect → Extract: the dataset becomes the source, and the form comes back.
  await openIn(page, "Extract from it");
  await expect(page).toHaveURL(/\/extract$/);
  await expect(page.getByRole("button", { name: "Clear source" })).toBeVisible();
  await expect(page.getByText("osmix-merged").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract", exact: true })).toBeEnabled();
});
