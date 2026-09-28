import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { fromPbf, Osm, toPbfBuffer } from "osmix";

import { createWayRemovalInputs } from "../tests/fixtures/way-removal";

type PbfInput = string | { name: string; mimeType: string; buffer: Buffer };

async function loadPbf(card: Locator, page: Page, path: PbfInput) {
  await card.getByRole("button", { name: "Open file" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /^OSM PBF/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path);
  const fileInfo = card.getByRole("button", { name: "File info" });
  const loadFailure = card.getByRole("alert");
  await expect(fileInfo.or(loadFailure)).toBeVisible({
    timeout: 120_000,
  });
  if (await loadFailure.isVisible()) {
    throw new Error(`OSM load failed: ${await loadFailure.innerText()}`);
  }
}

const MONACO_PBF = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));

test("loads both inputs once and reaches exact reconciliation", async ({ page }) => {
  // Keep this worker-backed journey to one load per input. Input-card actions,
  // clearing, and responsive geometry run against the production header in the
  // guidance harness instead of repeating PBF parsing and MapLibre resizing here.
  // Multi-worker replication has dedicated coverage in worker-runtime.spec.ts;
  // keeping this UI journey to one app worker avoids duplicating both inputs.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      get: () => 1,
    });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.osmWorker?.workerCount ?? 0)).toBe(1);

  const baseCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Base OSM — authoritative existing dataset" })
    .first();
  const patchCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Patch OSM — imported additions and updates" })
    .first();

  await expect(baseCard.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Open file" })).toBeVisible();

  await loadPbf(baseCard, page, MONACO_PBF);
  await expect(baseCard.locator('[data-slot="card-description"]')).toHaveText("monaco.pbf");
  await expect(baseCard.getByRole("button", { name: "Export base OSM as PBF" })).toBeVisible();
  await expect(baseCard.getByRole("button", { name: "Clear base OSM file" })).toBeVisible();
  const fileInfo = baseCard.getByRole("button", { name: "File info" });
  await fileInfo.click();
  await expect(baseCard.getByRole("row").filter({ hasText: "file name" })).toContainText(
    "monaco.pbf",
  );
  await expect(baseCard).toContainText("14,286");

  // Use the one Monaco PBF tracked by Git for both roles. The guidance harness
  // covers distinct displayed filenames without depending on local-only files.
  await loadPbf(patchCard, page, MONACO_PBF);
  await expect(patchCard.locator('[data-slot="card-description"]')).toHaveText("monaco.pbf");
  await expect(patchCard.getByRole("button", { name: "Export patch OSM as PBF" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Clear patch OSM file" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Save to storage" })).toHaveCount(0);
  await patchCard.getByRole("button", { name: "File info" }).click();
  await expect(patchCard.getByRole("row").filter({ hasText: "file name" })).toContainText(
    "monaco.pbf",
  );

  // Within-file duplicates are fixed in Inspect before merging.
  const inspectLink = page.getByRole("link", { name: "Inspect app" });
  await expect(inspectLink).toBeVisible();
  await expect(inspectLink).toHaveAttribute("href", /inspect/);

  // Review plan is the default entry point: nothing changes until the plan is applied.
  await page.getByRole("button", { name: "Review plan" }).click();
  await expect(page.getByRole("heading", { name: /^2\.\s*Review the plan$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Plan summary" })).toBeVisible();
  // The same file as base and patch: every positive ID names a base entity.
  await expect(page.getByText(/patch entities replace base entities/)).toBeVisible();
  const actions = page.getByRole("group", { name: "Plan review actions" });
  await expect(actions.getByRole("button", { name: "Export osmChange (.osc)" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Apply plan" })).toBeEnabled();
  await actions.getByRole("button", { name: "Back to inputs" }).click();
  await expect(page.getByRole("heading", { name: /^1\.\s*Choose the inputs$/ })).toBeVisible();
});

async function tinyInputs() {
  const base = new Osm({ id: "tiny-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Old entrance" } });
  base.nodes.addNode({ id: 2, lon: -0.001, lat: 0.001 });
  base.nodes.buildIndex();
  base.ways.addWay({ id: 10, refs: [2, 1], tags: { highway: "footway" } });
  base.buildIndexes();
  const patch = new Osm({ id: "tiny-patch" });
  patch.nodes.addNode({ id: 101, lon: 0.000005, lat: 0, tags: { name: "Imported entrance" } });
  patch.buildIndexes();
  return {
    base: {
      name: "completion-base.pbf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(await toPbfBuffer(base)),
    },
    patch: {
      name: "completion-patch.pbf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(await toPbfBuffer(patch)),
    },
  };
}

async function openTinyMerge(page: Page, inputs: Awaited<ReturnType<typeof tinyInputs>>) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 1 });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.osmWorker?.workerCount ?? 0)).toBe(1);
  const baseCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Base OSM — authoritative existing dataset" })
    .first();
  const patchCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Patch OSM — imported additions and updates" })
    .first();
  await loadPbf(baseCard, page, inputs.base);
  await loadPbf(patchCard, page, inputs.patch);
  return { baseCard, patchCard };
}

test("a tiny automatic matching merge retains its report and starts a clean new merge", async ({
  page,
}) => {
  const inputs = await tinyInputs();
  const { baseCard, patchCard } = await openTinyMerge(page, inputs);
  await page.getByRole("checkbox", { name: "Enable proximity matching" }).check();
  await page.getByLabel("OSM tag keys to copy").fill("name");
  const radius = page.getByRole("spinbutton", { name: "Candidate search radius (meters)" });
  await radius.fill("0");
  const start = page.getByRole("button", { name: "Apply automatically" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(radius).toBeFocused();
  await expect(radius).toHaveAttribute("aria-invalid", "true");
  await expect(radius).toHaveAccessibleDescription(/greater than zero/i);
  await expect(page.getByLabel("Merge completion summary")).toHaveCount(0);
  await expect(baseCard).toContainText(inputs.base.name);
  await expect(patchCard).toContainText(inputs.patch.name);
  await radius.fill("1");
  await expect(radius).not.toHaveAttribute("aria-invalid", "true");
  await start.click();
  const summary = page.getByLabel("Merge completion summary");
  await expect(summary).toBeVisible();
  await expect(page.getByRole("button", { name: "Export merged PBF" })).toBeVisible();
  await expect(summary.getByLabel("Applied matching actions").locator("dd")).toHaveText([
    "1",
    "1",
    "0",
    "0",
    "0",
  ]);
  await expect(summary.getByLabel("Imported features by outcome")).toContainText("Merged");
  await expect(summary).toContainText("completion-base.pbf + completion-patch.pbf");
  const downloadPromise = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Export merge report (JSON)" }).click();
  const reportFile = await (await downloadPromise).path();
  if (!reportFile) throw Error("Missing automatic merge report download");
  expect(JSON.parse(await readFile(reportFile, "utf8"))).toMatchObject({
    format: "osmix-merge-outcome",
    version: 2,
    plan: {
      summary: { features: { merged: 1 } },
      matching: {
        outcome: {
          summary: { tagCopyActions: 1, unresolvedFeatures: 0 },
          features: [{ entityType: "node", sourceId: 101, copiedKeys: ["name"] }],
        },
      },
    },
  });
  // Automated Chromium cannot use the native save picker, so this covers the Blob download path.
  const pbfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export merged PBF" }).click();
  const mergedPbf = await pbfDownload;
  expect(mergedPbf.suggestedFilename()).toMatch(/\.pbf$/);
  const mergedPbfPath = await mergedPbf.path();
  if (!mergedPbfPath) throw Error("Missing merged PBF download");
  const merged = await fromPbf(await readFile(mergedPbfPath), { id: "downloaded-merge" });
  expect(merged.ways.getById(10)?.refs).toEqual([2, 1]);
  expect(merged.nodes.getById(1)?.tags?.["name"]).toBe("Imported entrance");
  await page.getByRole("button", { name: "Start a new merge" }).click();
  await expect(page.getByRole("heading", { name: /^1\.\s*Choose the inputs$/ })).toBeVisible();
  await expect(summary).toHaveCount(0);
  await expect(baseCard.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(baseCard).not.toContainText("completion-base.pbf");
  await expect(patchCard).not.toContainText("completion-patch.pbf");
});

test("a removal chosen in the review is applied and reported", async ({ page }) => {
  const { base, patch } = createWayRemovalInputs();
  await openTinyMerge(page, {
    base: {
      name: "removal-base.pbf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(await toPbfBuffer(base)),
    },
    patch: {
      name: "removal-patch.pbf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(await toPbfBuffer(patch)),
    },
  });
  await page.getByRole("checkbox", { name: "Enable proximity matching" }).check();
  await page.getByRole("checkbox", { name: "Copy tags", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Review redundant way removal" }).check();
  await page.getByRole("button", { name: "Review plan" }).click();
  const feature = page.getByRole("region", { name: "Imported way 20", exact: true });
  await expect(feature).toContainText("Needs decision");
  const removal = feature.locator('[data-proposal-id="remove:w20>w10"]');
  // The choice replans in the worker; the radio follows the plan once it returns.
  const include = removal.getByRole("radio", { name: "Include", exact: true });
  await include.click();
  await expect(include).toBeChecked();
  await expect(feature).toContainText("Removed");
  await page.getByRole("button", { name: "Apply plan", exact: true }).click();
  const completion = page.getByRole("region", { name: "Merge completion summary", exact: true });
  await expect(
    completion.getByRole("region", { name: "Applied way removals", exact: true }),
  ).toContainText("Removed imported ways: 1");
  const download = page.waitForEvent("download");
  await completion.getByRole("button", { name: "Export merge report (JSON)" }).click();
  const reportPath = await (await download).path();
  if (!reportPath) throw Error("Missing removal report download");
  expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({
    plan: {
      matching: {
        outcome: {
          summary: { wayRemovalActions: 1, removedOrphanNodes: 2 },
          features: [
            { wayRemoval: { sourceWayId: 20, retainedWayId: 10, orphanNodeIds: [101, 102] } },
          ],
        },
      },
    },
  });
});

test("a late cancellation preserves the committed exact result and replacing the base clears completion", async ({
  page,
}) => {
  const inputs = await tinyInputs();
  const { baseCard } = await openTinyMerge(page, inputs);
  // Hold only the return after the real worker commits, so cancellation exercises
  // the actual irreversible boundary without racing a tiny fixture's parse time.
  await page.evaluate(() => {
    const remote = window.osmWorker;
    const apply = remote.applyMergePlan.bind(remote);
    remote.applyMergePlan = async (...args) => {
      const result = await apply(...args);
      const get = remote.get.bind(remote);
      let refreshFailures = 1;
      remote.get = async (osmId) => {
        if (osmId === result.dataset.id && refreshFailures > 0) {
          refreshFailures--;
          throw Error("Injected completed-result refresh failure");
        }
        return get(osmId);
      };
      document.documentElement.setAttribute("data-test-merge-committed", "true");
      await new Promise<void>((resolve) => {
        document.addEventListener("test-release-merge", () => resolve(), { once: true });
      });
      return result;
    };
  });
  await page.getByRole("button", { name: "Apply automatically" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-test-merge-committed", "true");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event("test-release-merge")));
  const summary = page.getByLabel("Merge completion summary");
  // Scope to the in-page Alert: the task's error toast is also a live `alert` region.
  await expect(page.locator('[data-slot="alert"][role="alert"]')).toContainText(
    "Injected completed-result refresh failure",
  );
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply automatically" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export merged PBF" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh merged dataset" }).click();
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Imported-data matching was not enabled");
  await expect(page.getByRole("button", { name: "Export merged PBF" })).toBeVisible();

  // Clearing the base from the "Merged OSM" card only empties the slot; nothing is promoted
  // into it. "Use as base" on the patch card is the explicit move, and it is disabled while a
  // base is loaded. Either way the base dataset changes, which must invalidate the completed
  // merge.
  await page.getByRole("button", { name: "Clear merged OSM" }).click();
  await loadPbf(baseCard, page, inputs.base);
  await expect(page.getByRole("heading", { name: /^1\.\s*Choose the inputs$/ })).toBeVisible();
  await expect(summary).toHaveCount(0);
  await expect(baseCard.getByRole("button", { name: "File info" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export merged PBF" })).toHaveCount(0);
});
