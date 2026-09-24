import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

test("extracts a bounding box from a PBF and offers the result for download", async ({ page }) => {
  await page.goto("/");

  // The nav links to the sibling apps and marks this one as current.
  await expect(page.getByRole("link", { name: "Merge" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Inspect" })).toBeVisible();

  // The shared place search is open by default, and Extract adds no second search box.
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(1);

  // A small box in the middle of Monaco.
  await page.getByLabel("Paste bbox", { exact: false }).fill("7.415,43.73,7.425,43.74");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.getByRole("radio", { name: "Simple" }).check();

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open file", exact: true }).click();
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

test("extracts using the bounds recorded in the selected file's header", async ({ page }) => {
  await page.goto("/");

  const useFileBounds = page.getByRole("checkbox", { name: "Use the selected file's bounds" });
  await expect(useFileBounds).toBeDisabled();
  await expect(page.getByText("Select a PBF file in step 1 first")).toBeVisible();

  const minLon = page.locator("#extract-bbox-min-lon");
  const previousMinLon = await minLon.inputValue();

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await (await chooserPromise).setFiles(MONACO_PBF);

  // monaco.pbf records its bounds in the PBF header.
  await expect(useFileBounds).toBeEnabled();
  await useFileBounds.check();
  await expect(minLon).toHaveValue("7.4053929");
  // Fitting the map to the file's bounds moves the camera; map panels re-render on camera
  // moves and must not pull focus away (the place search used to refocus on every render).
  await page.waitForTimeout(700);
  await expect(useFileBounds).toBeFocused();
  await expect(page.locator("#extract-bbox-min-lat")).toHaveValue("43.7232244");
  await expect(page.locator("#extract-bbox-max-lon")).toHaveValue("7.4447259");
  await expect(page.locator("#extract-bbox-max-lat")).toHaveValue("43.7543687");
  for (const id of ["min-lon", "min-lat", "max-lon", "max-lat"]) {
    await expect(page.locator(`#extract-bbox-${id}`)).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Parse", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Use current map view as bbox" })).toBeDisabled();

  await page.getByRole("radio", { name: "Simple" }).check();
  const extractButton = page.getByRole("button", { name: "Extract", exact: true });
  await expect(extractButton).toBeEnabled();
  await extractButton.click();
  const download = page.getByRole("button", { name: "Download extracted PBF" });
  await expect(download).toBeEnabled({ timeout: 120_000 });

  // Unchecking gives back the bbox from before, and the controls unlock.
  await useFileBounds.uncheck();
  await expect(minLon).toHaveValue(previousMinLon);
  await expect(minLon).toBeEnabled();
});
