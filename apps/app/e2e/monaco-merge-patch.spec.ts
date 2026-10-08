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

async function loadFile(section: Locator, page: Page, menuItem: RegExp, path: string) {
  await section.getByRole("button", { name: "Open file" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: menuItem }).click();
  await (await fileChooserPromise).setFiles(path);
  const fileInfo = section.getByRole("button", { name: "File info" });
  const loadFailure = section.getByRole("alert");
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
  await page.goto("/merge");
  await expect.poll(() => page.evaluate(() => window.osmWorker?.workerCount ?? 0)).toBe(1);
  const section = (text: string) =>
    page.locator('[data-slot="sidebar-section"]').filter({ hasText: text }).first();
  await loadFile(
    section("Base OSM — authoritative existing dataset"),
    page,
    /^OSM PBF/,
    MONACO_PBF,
  );
  await loadFile(
    section("Patch OSM — imported additions and updates"),
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
  await page.getByRole("button", { name: "Apply automatically" }).click();
  const summary = page.getByLabel("Merge completion summary");
  await expect(summary).toBeVisible({ timeout: 120_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export merged PBF" }).click();
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
  await page.getByRole("button", { name: "Export merged PBF" }).click();
  const positivePath = await (await positiveDownload).path();
  if (!positivePath) throw Error("Missing positive-ID PBF download");
  const positive = await fromPbf(await readFile(positivePath), { id: "monaco-positive" });
  const ids = [...positive.nodes, ...positive.ways, ...positive.relations].map((e) => e.id);
  expect(ids.every((id) => id > 0)).toBe(true);
  const reportDownload = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Export merge report (JSON)" }).click();
  const reportPath = await (await reportDownload).path();
  if (!reportPath) throw Error("Missing merge report download");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    idMap: { ways: Record<string, number> };
    plan: { matching: { outcome: { summary: { unmatchedFeatures: number } } } };
  };
  // Nothing nearby is its own count, on screen and in the report, not unresolved work.
  const { unmatchedFeatures } = report.plan.matching.outcome.summary;
  await expect(summary).toContainText(
    `No base feature nearby: ${unmatchedFeatures.toLocaleString("en-US")}.`,
  );
  const a1 = report.idMap.ways[String(scenarioFeatureId(17, 1))];
  expect(positive.ways.getById(a1!)?.refs[0]).toBe(6487733397);
});

test("the reviewed workflow removes the accepted duplicate footway", async ({ page }) => {
  await openMonacoMerge(page, { removal: true });
  await page.getByRole("button", { name: "Review plan" }).click();
  await expect(page.getByRole("region", { name: "Plan summary" })).toBeVisible();

  // The plan layer's key sits in the map legend, not the sidebar.
  await expect(
    page.getByRole("group", { name: "Loaded data" }).getByLabel("Plan map legend"),
  ).toContainText("Needs decision");

  // Filter the imported features to those with a removal proposal.
  await page.getByLabel("Proposal", { exact: true }).selectOption({ label: "Remove imported way" });
  const removal = (id: number) =>
    page
      .getByRole("region", { name: `Imported way ${id}`, exact: true })
      .locator(`[data-proposal-id^="remove:w${id}>"]`);

  // R2 keeps an unconnected branch, so its removal is blocked and takes no choice.
  const r2 = removal(scenario("R2").features[0]!.id);
  await expect(r2).toContainText("Blocked");
  await expect(r2.getByRole("radio")).toHaveCount(0);

  const r1Id = scenario("R1").features[0]!.id;
  const r1 = page.getByRole("region", { name: `Imported way ${r1Id}`, exact: true });
  // Row choices collect until applied together; applying replans once.
  const include = removal(r1Id).getByRole("radio", { name: "Include", exact: true });
  await include.click();
  await expect(include).toBeChecked();
  await page.getByRole("button", { name: "Apply 1 choice", exact: true }).click();
  await expect(r1).toContainText("Removed");
  await r1.getByRole("button", { name: "Show on map and evidence" }).click();
  await expect(r1.getByRole("button", { name: "Showing on map" })).toBeVisible();

  // Include leaves a choice between a point's possible targets alone (MP-M5). M7's two
  // footway spurs, on different imported ways, end near one base node: both can connect there,
  // so neither waits on the other. Counts are in features.
  await page.getByLabel("Proposal", { exact: true }).selectOption({ label: "Connect network" });
  await expect(page.getByText(/After Include, 1 still need their own choice/)).toBeVisible();
  await page.getByRole("button", { name: /^Include \d+ features?$/ }).click();
  await expect(
    page.getByText(/^Included \d+ features?; 1 feature still needs a decision/),
  ).toBeVisible();
  await expect(page.getByText("Choose for shown features failed")).toHaveCount(0);
  await expect(page.getByText(/can also connect to base node/)).toHaveCount(0);

  // The plan downloads as osmChange without applying anything.
  const oscDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export osmChange (.osc)" }).click();
  const oscPath = await (await oscDownload).path();
  if (!oscPath) throw Error("Missing osmChange download");
  const osc = await readFile(oscPath, "utf8");
  expect(osc).toContain("<osmChange");
  expect(osc).not.toContain(`<way id="${r1Id}"`);

  await page.getByRole("button", { name: "Apply plan", exact: true }).click();
  const completion = page.getByRole("region", { name: "Merge completion summary", exact: true });
  await expect(
    completion.getByRole("region", { name: "Applied way removals", exact: true }),
  ).toContainText("Removed imported ways: 1");
});
