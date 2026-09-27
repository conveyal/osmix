import { readFile } from "node:fs/promises";

import { getFixturePath } from "@osmix/test-utils/fixtures";
import {
  MONACO_MERGE_CONFLATION,
  MONACO_MERGE_PATCH,
  MONACO_MERGE_SCENARIOS,
  scenarioFeatureId,
} from "@osmix/test-utils/monaco-merge-scenarios";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { fromPbf } from "osmix";

const MONACO_PBF = getFixturePath("monaco.pbf");
const PATCH_GEOJSON = getFixturePath(MONACO_MERGE_PATCH);

/** The scenario with `id`; the fixture defines what each one should do. */
function scenario(id: string) {
  const found = MONACO_MERGE_SCENARIOS.find((s) => s.id === id);
  if (!found) throw Error(`No scenario ${id}`);
  return found;
}

async function loadFile(card: Locator, page: Page, menuItem: RegExp, path: string) {
  await card.getByRole("button", { name: "Open file" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: menuItem }).click();
  await (await fileChooserPromise).setFiles(path);
  const fileInfo = card.getByRole("button", { name: "File info" });
  const loadFailure = card.getByRole("alert");
  await expect(fileInfo.or(loadFailure)).toBeVisible({ timeout: 120_000 });
  if (await loadFailure.isVisible()) {
    throw new Error(`Load failed: ${await loadFailure.innerText()}`);
  }
}

/** Load Monaco as the base and the scenario GeoJSON as the patch, with matching configured. */
async function openMonacoMerge(page: Page, { removal }: { removal: boolean }) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 1 });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.osmWorker?.workerCount ?? 0)).toBe(1);
  const card = (text: string) =>
    page.locator('[data-slot="card"]').filter({ hasText: text }).first();
  await loadFile(card("Base OSM — authoritative existing dataset"), page, /^OSM PBF/, MONACO_PBF);
  await loadFile(
    card("Patch OSM — imported additions and updates"),
    page,
    /^GeoJSON/,
    PATCH_GEOJSON,
  );
  await page.getByRole("checkbox", { name: "Enable proximity matching" }).check();
  await page
    .getByLabel("OSM tag keys to copy")
    .fill(MONACO_MERGE_CONFLATION.propertyKeys.join(", "));
  await page.getByRole("checkbox", { name: "Connect network" }).check();
  if (removal) await page.getByRole("checkbox", { name: "Review redundant way removal" }).check();
}

test("the automatic workflow merges the Monaco scenario patch", async ({ page }) => {
  await openMonacoMerge(page, { removal: false });
  await page
    .getByRole("checkbox", { name: "Run every stage automatically, without review" })
    .check();
  await page.getByRole("button", { name: "Start merge" }).click();
  const summary = page.getByLabel("Merge completion summary");
  await expect(summary).toBeVisible({ timeout: 120_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download merged OSM PBF" }).click();
  const path = await (await download).path();
  if (!path) throw Error("Missing merged PBF download");
  const merged = await fromPbf(await readFile(path), { id: "monaco-merged" });

  // Representative outcomes, one per stage; the package test checks every scenario.
  const [d2] = scenario("D2").features;
  expect(merged.nodes.getById(d2!.id)?.tags).toEqual(d2!.tags);
  expect(merged.nodes.getById(scenarioFeatureId(5, 1))).toBeNull(); // X1 reconciled
  expect(merged.nodes.getById(21914341)?.tags?.["tactile_paving"]).toBe("yes");
  expect(merged.nodes.getById(1031563224)?.tags?.["opening_hours"]).toBe("24/7"); // M1 copied
  expect(merged.ways.getById(scenarioFeatureId(17, 1))?.refs[0]).toBe(6487733397); // A1 attached
  expect(merged.ways.getById(4230116)?.tags?.["surface"]).toBe("asphalt"); // W1 copied
  expect(merged.nodes.getById(1736938084)?.tags?.["kerb"]).toBe("lowered"); // M2 left for review
  const i1 = merged.ways.getById(scenarioFeatureId(26, 1))?.refs ?? [];
  const crossed = new Set(merged.ways.getById(687577837)?.refs);
  const shared = i1.filter((ref) => crossed.has(ref));
  expect(shared).toHaveLength(1); // I1 crossing node
  expect(merged.nodes.getById(shared[0]!)?.tags?.["crossing"]).toBe("yes");

  // With positive IDs, the download has no negative IDs and the report maps each new one.
  await page.getByRole("checkbox", { name: "Give new features positive IDs" }).check();
  const positiveDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download merged OSM PBF" }).click();
  const positivePath = await (await positiveDownload).path();
  if (!positivePath) throw Error("Missing positive-ID PBF download");
  const positive = await fromPbf(await readFile(positivePath), { id: "monaco-positive" });
  const ids = [...positive.nodes, ...positive.ways, ...positive.relations].map((e) => e.id);
  expect(ids.every((id) => id > 0)).toBe(true);
  const reportDownload = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Download merge report" }).click();
  const reportPath = await (await reportDownload).path();
  if (!reportPath) throw Error("Missing merge report download");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    idMap: { ways: Record<string, number> };
  };
  const a1 = report.idMap.ways[String(scenarioFeatureId(17, 1))];
  expect(positive.ways.getById(a1!)?.refs[0]).toBe(6487733397);
});

test("the reviewed workflow removes the accepted duplicate footway", async ({ page }) => {
  await openMonacoMerge(page, { removal: true });
  await page.getByRole("button", { name: "Start merge" }).click();
  await page.getByRole("button", { name: "Preview direct merge" }).click();
  await page.getByRole("button", { name: "Continue to matching and reconciliation" }).click();
  await page.getByRole("button", { name: "Discover match candidates" }).click();

  // The review lists about 110 imported features across pages; filter to the ways.
  const removal = (feature: number) =>
    page
      .getByRole("region", { name: `Imported way ${feature}`, exact: true })
      .getByRole("checkbox", { name: "Remove imported way", exact: true });
  await page
    .getByRole("combobox", { name: "Feature type", exact: true })
    .selectOption({ label: "Line or area (OSM way)" });
  const status = page.getByRole("combobox", { name: "Match status", exact: true });

  // R2 keeps an unconnected branch, so its removal is blocked.
  await status.selectOption({ label: "Blocked" });
  await expect(removal(scenario("R2").features[0]!.id)).toBeDisabled();

  await status.selectOption({ label: "Needs review" });
  const removeR1 = removal(scenario("R1").features[0]!.id);
  await expect(removeR1).not.toBeChecked();
  await removeR1.click();
  // Choosing removal schedules R1, so it moves out of "Needs review".
  await status.selectOption({ label: "Scheduled" });
  await expect(removeR1).toBeChecked();

  await page.getByRole("button", { name: "Continue with current decisions" }).click();
  await page.getByRole("button", { name: "Preview with exact reconciliation" }).click();
  const preview = page.getByRole("region", { name: "Way removal preview", exact: true });
  await expect(preview).toContainText("Imported ways to remove: 1");
  await page.getByRole("button", { name: "Apply cumulative merge", exact: true }).click();
  await page.getByRole("button", { name: "Skip intersections and finish" }).click();
  const completion = page.getByRole("region", { name: "Merge completion summary", exact: true });
  await expect(
    completion.getByRole("region", { name: "Applied way removals", exact: true }),
  ).toContainText("Removed imported ways: 1");
});
