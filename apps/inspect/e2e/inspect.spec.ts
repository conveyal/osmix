import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import { fromPbf, Osm, toPbfBuffer } from "osmix";

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

type PbfInput = string | { name: string; mimeType: string; buffer: Buffer };

async function loadPbf(page: Page, input: PbfInput) {
  await page.getByRole("button", { name: "Open file" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /^OSM PBF/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(input);

  const fileInfo = page.getByRole("button", { name: "File info" });
  // The in-page Alert, not the error toast that also announces as \`alert\`.
  const loadFailure = page.locator('[data-slot="alert"][role="alert"]');
  await expect(fileInfo.or(loadFailure)).toBeVisible({ timeout: 120_000 });
  if (await loadFailure.isVisible()) {
    throw new Error(`OSM load failed: ${await loadFailure.innerText()}`);
  }
}

/** Two ways that duplicate each other node for node, plus a relation that references both. */
function createDuplicatedOsm() {
  const osm = new Osm({ id: "duplicates" });
  osm.nodes.addNode({ id: 1, lon: 7.42, lat: 43.73 });
  osm.nodes.addNode({ id: 2, lon: 7.421, lat: 43.73 });
  osm.nodes.addNode({ id: 11, lon: 7.42, lat: 43.73 });
  osm.nodes.addNode({ id: 12, lon: 7.421, lat: 43.73 });
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 20, refs: [11, 12], tags: { highway: "residential" } });
  osm.relations.addRelation({
    id: 100,
    tags: { type: "route" },
    members: [
      { type: "way", ref: 10, role: "" },
      { type: "way", ref: 20, role: "" },
    ],
  });
  osm.buildIndexes();
  return osm;
}

test("loads a PBF, renders the map, and runs duplicate diagnostics", async ({ page }) => {
  await page.goto("/");

  // The nav links to the sibling apps and marks this one as current.
  const nav = page.getByRole("navigation").or(page.locator("body"));
  await expect(nav.getByRole("link", { name: "Merge" })).toBeVisible();
  await expect(page.getByText("Inspect", { exact: true }).first()).toBeVisible();

  await loadPbf(page, MONACO_PBF);
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
  await expect(page.getByText("Duplicate candidates", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText("Summary", { exact: true })).toBeVisible();
  // Monaco has no exact duplicates, so there is nothing to apply.
  await expect(page.getByRole("button", { name: "Apply fixes" })).toHaveCount(0);
});

test("applies duplicate fixes and downloads the deduplicated PBF", async ({ page }) => {
  await page.goto("/");
  await loadPbf(page, {
    name: "duplicates.osm.pbf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(await toPbfBuffer(createDuplicatedOsm())),
  });

  await page.getByRole("button", { name: "How this scan works" }).click();
  await expect(page.getByText("What applying changes")).toBeVisible();

  await page.getByRole("button", { name: "Find duplicate nodes and ways" }).click();
  await expect(page.getByText("Duplicate candidates", { exact: true })).toBeVisible({
    timeout: 120_000,
  });

  await page.getByRole("button", { name: "Apply fixes" }).click();
  const dialog = page.getByRole("dialog", { name: "Apply duplicate fixes?" });
  await expect(dialog).toContainText("2 duplicate nodes and 1 duplicate way.");
  await dialog.getByRole("button", { name: /^Apply \d+ changes$/ }).click();

  await expect(page.locator('[data-slot="alert"]').getByText(/^Applied \d+ changes$/)).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText("Duplicate candidates", { exact: true })).toHaveCount(0);

  // Automated Chromium cannot use the native save picker, so this covers the Blob download path.
  const pbfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download deduplicated PBF" }).click();
  const download = await pbfDownload;
  expect(download.suggestedFilename()).toBe("osmix-duplicates-deduplicated.pbf");
  const downloadPath = await download.path();
  if (!downloadPath) throw Error("Missing deduplicated PBF download");
  const cleaned = await fromPbf(await readFile(downloadPath), { id: "downloaded-cleaned" });
  expect(cleaned.nodes.size).toBe(2);
  expect(cleaned.ways.size).toBe(1);
  expect(cleaned.ways.getById(20)?.refs).toEqual([11, 12]);
  const memberRefs = cleaned.relations.getById(100)?.members.map((member) => member.ref);
  expect(new Set(memberRefs)).toEqual(new Set([20]));

  // A re-scan of the applied result finds nothing left to fix.
  await page.getByRole("button", { name: "Find duplicate nodes and ways" }).click();
  await expect(page.getByText("Duplicate candidates", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByRole("button", { name: "Apply fixes" })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Found 0 duplicate candidates" }),
  ).toBeVisible();
});
