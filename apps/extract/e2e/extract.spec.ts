import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

test("extracts a bounding box from a PBF and offers the result for download", async ({ page }) => {
  await page.goto("/");

  // The nav links to the sibling apps and marks this one as current.
  await expect(page.getByRole("link", { name: "Merge" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Inspect" })).toBeVisible();

  // A small box in the middle of Monaco.
  await page.getByLabel("Paste bbox", { exact: false }).fill("7.415,43.73,7.425,43.74");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.getByRole("radio", { name: "Simple" }).check();

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Select PBF", exact: true }).click();
  await (await chooserPromise).setFiles(MONACO_PBF);

  const extractButton = page.getByRole("button", { name: "Extract", exact: true });
  await expect(extractButton).toBeEnabled();
  await extractButton.click();

  const download = page.getByRole("button", { name: "Download extracted PBF" });
  const failure = page.getByRole("alert");
  // Extraction crosses the worker boundary; wait for its outcome rather than the default limit.
  await expect
    .poll(async () => (await download.isEnabled()) || (await failure.isVisible()), {
      timeout: 120_000,
    })
    .toBe(true);
  if (await failure.isVisible()) {
    throw new Error(`OSM extraction failed: ${await failure.innerText()}`);
  }
  await expect(download).toBeEnabled();
  await expect(page.getByRole("button", { name: "File info" })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
});
