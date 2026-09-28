import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

/** Select Monaco as the source PBF, which the extract streams. */
async function openPbf(page: Page) {
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /^OSM PBF/ }).click();
  await (await chooserPromise).setFiles(MONACO_PBF);
}

test("extracts a bounding box from a PBF and offers the result for download", async ({ page }) => {
  await page.goto("/extract");

  // The nav links to the other pages and marks this one as current.
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Merge" })).toHaveAttribute("href", "/merge");
  await expect(nav.getByRole("link", { name: "Inspect" })).toHaveAttribute("href", "/inspect");
  await expect(nav.getByText("Extract", { exact: true })).toHaveAttribute("aria-current", "page");

  // Exactly one button is named "Search": the submit of the place search embedded in step 2.
  // The map's own search is closed by default (its toggle is "Open map search" and its submit
  // is "Run search"), so it adds no second one.
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(1);

  // A small box in the middle of Monaco.
  await page.getByLabel("Paste bbox", { exact: false }).fill("7.415,43.73,7.425,43.74");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.getByRole("radio", { name: "Simple" }).check();

  await openPbf(page);

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
  // The result replaces the form and describes the extract, with its load details open.
  await expect(page.getByText("Select OSM PBF file")).toHaveCount(0);
  await expect(extractButton).toHaveCount(0);
  const stats = page.getByRole("table", { name: "Extract statistics" });
  await expect(stats).toContainText("Simple");
  await expect(stats).toContainText("7.415, 43.73, 7.425, 43.74");
  await expect(page.getByRole("button", { name: "Load details" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  // Saving stores the extract as its own dataset: keyed by its content hash and named for the
  // extract, never under the source file's hash (which would shadow the full source in the
  // cache).
  await page.getByRole("button", { name: "Save extract result to storage" }).click();
  await expect
    .poll(() => page.evaluate(async () => (await window.osmWorker.listStoredOsm()).length))
    .toBe(1);
  const [stored] = await page.evaluate(() => window.osmWorker.listStoredOsm());
  // Development serves `fixtures/` as the public directory.
  const sourceHash = await page.evaluate(async () => {
    const bytes = await (await fetch("/monaco.pbf")).arrayBuffer();
    return window.osmWorker.hashBuffer(bytes);
  });
  expect(stored?.fileName).toBe("monaco-extract.pbf");
  expect(stored?.fileHash).not.toBe(sourceHash);

  // Clearing the result brings the form back with the same file and settings; the selected
  // file's info sits with the file.
  await page.getByRole("button", { name: "Clear extract result" }).click();
  await expect(download).toHaveCount(0);
  await expect(page.locator("#extract-bbox-min-lon")).toHaveValue("7.415");
  await expect(page.getByRole("radio", { name: "Simple" })).toBeChecked();
  await page.getByRole("button", { name: "File info" }).click();
  await expect(page.getByRole("table", { name: "Selected file" })).toContainText("monaco.pbf");
  await expect(extractButton).toBeEnabled();
});

test("extracts using the bounds recorded in the selected file's header", async ({ page }) => {
  await page.goto("/extract");

  const useFileBounds = page.getByRole("checkbox", { name: "Use the selected file's bounds" });
  await expect(useFileBounds).toBeDisabled();
  await expect(page.getByText("Select a PBF file in step 1 first")).toBeVisible();

  const minLon = page.locator("#extract-bbox-min-lon");

  await openPbf(page);

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

  // Clearing the result brings the form back, still using the file's bounds. Unchecking gives
  // back the bbox from before, and the controls unlock. The embedded place search remounts
  // with them and must not steal focus.
  await page.getByRole("button", { name: "Clear extract result" }).click();
  await expect(useFileBounds).toBeChecked();
  await useFileBounds.uncheck();
  await expect(useFileBounds).toBeFocused();
  await expect(minLon).toHaveValue(previousMinLon);
  await expect(minLon).toBeEnabled();
});

test("extracts from a stored dataset opened with ?load=, the same as from the file", async ({
  page,
}) => {
  await page.goto("/extract");
  // Extract a strict box from the streamed file first, for comparison.
  await page.getByLabel("Paste bbox", { exact: false }).fill("7.415,43.73,7.425,43.74");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.getByRole("radio", { name: "Simple" }).check();
  await openPbf(page);
  await page.getByRole("button", { name: "Extract", exact: true }).click();
  const stats = page.getByRole("table", { name: "Extract statistics" });
  await expect(stats).toBeVisible({ timeout: 120_000 });
  const fromFile = await stats.innerText();

  // Store the full source, then open it by hash as Extract's source.
  const fileHash = await page.evaluate(async () => {
    const bytes = await (await fetch("/monaco.pbf")).arrayBuffer();
    const hash = await window.osmWorker.hashBuffer(bytes);
    await window.osmWorker.fromPbf(bytes, { id: hash });
    await window.osmWorker.storeCurrentOsm(hash, {
      fileHash: hash,
      fileName: "monaco.pbf",
      fileSize: bytes.byteLength,
    });
    return hash;
  });
  await page.goto(`/extract?load=${fileHash}`);
  const clearSource = page.getByRole("button", { name: "Clear source" });
  await expect(clearSource).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/extract$/);
  // The source's bounds are known without reading a header.
  await expect(
    page.getByRole("checkbox", { name: "Use the selected file's bounds" }),
  ).toBeEnabled();
  await expect(page.locator("#extract-file-bounds-help")).toHaveText(
    "The dataset's extent: 7.4053929, 43.7232244, 7.4447259, 43.7543687",
  );

  await page.getByLabel("Paste bbox", { exact: false }).fill("7.415,43.73,7.425,43.74");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.getByRole("radio", { name: "Simple" }).check();
  await page.getByRole("button", { name: "Extract", exact: true }).click();
  await expect(stats).toBeVisible({ timeout: 120_000 });
  expect(await stats.innerText()).toBe(fromFile);
  await expect(page.getByRole("button", { name: "Save extract result to storage" })).toBeVisible();

  // Clearing the result keeps the source dataset for another extract.
  await page.getByRole("button", { name: "Clear extract result" }).click();
  await expect(clearSource).toBeVisible();
});
