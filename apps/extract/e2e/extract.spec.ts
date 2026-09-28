import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

test("extracts a bounding box from a PBF and offers the result for download", async ({ page }) => {
  await page.goto("/");

  // The nav links to the sibling apps and marks this one as current.
  await expect(page.getByRole("link", { name: "Merge" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Inspect" })).toBeVisible();

  // Exactly one button is named "Search": the submit of the place search embedded in step 2.
  // The map's own search is closed by default (its toggle is "Open map search" and its submit
  // is "Run search"), so it adds no second one.
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

  const download = page.getByRole("button", { name: "Export extract as PBF" });
  // The in-page Alert, not the error toast that also announces as \`alert\`.
  const failure = page.locator('[data-slot="alert"][role="alert"]');
  // Extraction crosses the worker boundary; wait for its outcome rather than the default limit.
  // The download button is only mounted after a successful extract, so wait for either it or
  // the failure alert to appear.
  await expect(download.or(failure)).toBeVisible({ timeout: 120_000 });
  if (await failure.isVisible()) {
    throw new Error(`OSM extraction failed: ${await failure.innerText()}`);
  }
  await expect(download).toBeEnabled();
  // The selected file's info sits with the file; the result card describes the extract.
  await page.getByRole("button", { name: "File info" }).click();
  await expect(page.getByRole("table", { name: "Selected file" })).toContainText("monaco.pbf");
  const stats = page.getByRole("table", { name: "Extract statistics" });
  await expect(stats).toContainText("Simple");
  await expect(stats).toContainText("7.415, 43.73, 7.425, 43.74");
  await expect(page.getByRole("button", { name: "Load details" })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
});

test("extracts using the bounds recorded in the selected file's header", async ({ page }) => {
  await page.goto("/");

  const useFileBounds = page.getByRole("checkbox", { name: "Use the selected file's bounds" });
  await expect(useFileBounds).toBeDisabled();
  await expect(page.getByText("Select a PBF file in step 1 first")).toBeVisible();

  const minLon = page.locator("#extract-bbox-min-lon");

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await (await chooserPromise).setFiles(MONACO_PBF);

  // monaco.pbf records its bounds in the PBF header. The unedited default bbox starts from
  // them, still editable: "Use the selected file's bounds" stays off.
  await expect(useFileBounds).toBeEnabled();
  await expect(minLon).toHaveValue("7.4053929");
  await expect(page.locator("#extract-bbox-max-lat")).toHaveValue("43.7543687");
  await expect(useFileBounds).not.toBeChecked();
  await expect(minLon).toBeEnabled();
  await minLon.fill("7.41");
  await minLon.blur();
  const previousMinLon = await minLon.inputValue();

  await useFileBounds.check();
  // The file's bbox replaces the coordinate inputs, which are hidden while it is in use.
  await expect(page.locator("#extract-file-bounds-help")).toHaveText(
    "From the file header: 7.4053929, 43.7232244, 7.4447259, 43.7543687",
  );
  await expect(minLon).toHaveCount(0);
  // Fitting the map to the file's bounds moves the camera; nothing on the map may pull focus
  // away while it does.
  await page.waitForTimeout(700);
  await expect(useFileBounds).toBeFocused();
  // The manual bbox controls are hidden with the inputs.
  await expect(page.getByRole("button", { name: "Parse", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use current map view as bbox" })).toHaveCount(0);

  await page.getByRole("radio", { name: "Simple" }).check();
  const extractButton = page.getByRole("button", { name: "Extract", exact: true });
  await expect(extractButton).toBeEnabled();
  await extractButton.click();
  const download = page.getByRole("button", { name: "Export extract as PBF" });
  await expect(download).toBeEnabled({ timeout: 120_000 });

  // Unchecking gives back the bbox from before, and the controls unlock. The embedded place
  // search remounts with them and must not steal focus.
  await useFileBounds.uncheck();
  await expect(useFileBounds).toBeFocused();
  await expect(minLon).toHaveValue(previousMinLon);
  await expect(minLon).toBeEnabled();
});
