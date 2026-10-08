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
  // Keep this worker-backed journey to one load per input. Input-section actions,
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
  await page.goto("/merge");
  await expect.poll(() => page.evaluate(() => window.osmWorker?.workerCount ?? 0)).toBe(1);

  const baseSection = page
    .locator('[data-slot="sidebar-section"]')
    .filter({ hasText: "Base OSM — authoritative existing dataset" })
    .first();
  const patchSection = page
    .locator('[data-slot="sidebar-section"]')
    .filter({ hasText: "Patch OSM — imported additions and updates" })
    .first();

  await expect(baseSection.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(patchSection.getByRole("button", { name: "Open file" })).toBeVisible();

  await loadPbf(baseSection, page, MONACO_PBF);
  await expect(baseSection.locator('[data-slot="osm-input-file-name"]')).toHaveText("monaco.pbf");
  await expect(baseSection.getByRole("button", { name: "Export base OSM as PBF" })).toBeVisible();
  await expect(baseSection.getByRole("button", { name: "Clear base OSM file" })).toBeVisible();
  const fileInfo = baseSection.getByRole("button", { name: "File info" });
  await fileInfo.click();
  await expect(baseSection.getByRole("row").filter({ hasText: "file name" })).toContainText(
    "monaco.pbf",
  );
  await expect(baseSection).toContainText("14,286");

  // The same file cannot be both inputs: the patch refuses it and loads nothing.
  await patchSection.getByRole("button", { name: "Open file" }).click();
  const refusedChooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /^OSM PBF/ }).click();
  await (await refusedChooser).setFiles(MONACO_PBF);
  await expect(patchSection.getByRole("alert")).toContainText(
    "monaco.pbf is already loaded as the Base.",
  );
  await expect(patchSection.getByRole("button", { name: "File info" })).toHaveCount(0);

  // A re-encoded copy has the same entities in different bytes, so it is a different file.
  // Every entity matches the base exactly.
  const monacoCopy = {
    name: "monaco-copy.pbf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(await toPbfBuffer(await fromPbf(await readFile(MONACO_PBF)))),
  };
  await loadPbf(patchSection, page, monacoCopy);
  await expect(patchSection.locator('[data-slot="osm-input-file-name"]')).toHaveText(
    "monaco-copy.pbf",
  );
  await expect(patchSection.getByRole("button", { name: "Export patch OSM as PBF" })).toBeVisible();
  await expect(patchSection.getByRole("button", { name: "Clear patch OSM file" })).toBeVisible();
  await expect(patchSection.getByRole("button", { name: "Save to storage" })).toHaveCount(0);
  await patchSection.getByRole("button", { name: "File info" }).click();
  await expect(patchSection.getByRole("row").filter({ hasText: "file name" })).toContainText(
    "monaco-copy.pbf",
  );

  // Within-file duplicates are fixed in Inspect before merging.
  const inspectLink = page.locator('[data-slot="alert"]').getByRole("link", { name: "Inspect" });
  await expect(inspectLink).toHaveAttribute("href", "/inspect");

  // Review plan is the default entry point: nothing changes until the plan is applied.
  await page.getByRole("button", { name: "Review plan" }).click();
  // The review opens at its top, not at the scroll the inputs step left behind.
  await expect(page.getByRole("heading", { name: /^2\.\s*Review the plan$/ })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Plan summary" })).toBeVisible();
  // The same entities as base and patch: every positive ID names a base entity.
  await expect(page.getByText(/patch entities replace base entities/)).toBeVisible();
  const actions = page.getByRole("group", { name: "Plan review actions" });
  await expect(actions.getByRole("button", { name: "Export osmChange (.osc)" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Apply plan" })).toBeEnabled();
  await actions.getByRole("button", { name: "Back to inputs" }).click();
  await expect(page.getByRole("heading", { name: /^1\.\s*Choose the inputs$/ })).toBeInViewport();

  // Each slot owns its worker dataset (`<slot>-<file hash>`) and frees it when cleared.
  // Development serves `fixtures/` as the public directory.
  const baseDatasetId = await page.evaluate(async () => {
    const bytes = await (await fetch("/monaco.pbf")).arrayBuffer();
    return `base-${await window.osmWorker.hashBuffer(bytes)}`;
  });
  expect(await page.evaluate((id) => window.osmWorker.has(id), baseDatasetId)).toBe(true);
  await baseSection.getByRole("button", { name: "Clear base OSM file" }).click();
  await expect
    .poll(() => page.evaluate((id) => window.osmWorker.has(id), baseDatasetId))
    .toBe(false);
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
  await page.goto("/merge");
  await expect.poll(() => page.evaluate(() => window.osmWorker?.workerCount ?? 0)).toBe(1);
  const baseSection = page
    .locator('[data-slot="sidebar-section"]')
    .filter({ hasText: "Base OSM — authoritative existing dataset" })
    .first();
  const patchSection = page
    .locator('[data-slot="sidebar-section"]')
    .filter({ hasText: "Patch OSM — imported additions and updates" })
    .first();
  await loadPbf(baseSection, page, inputs.base);
  await loadPbf(patchSection, page, inputs.patch);
  return { baseSection, patchSection };
}

test("a tiny automatic matching merge retains its report and starts a clean new merge", async ({
  page,
}) => {
  const inputs = await tinyInputs();
  const { baseSection, patchSection } = await openTinyMerge(page, inputs);
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
  await expect(baseSection).toContainText(inputs.base.name);
  await expect(patchSection).toContainText(inputs.patch.name);
  await radius.fill("1");
  await expect(radius).not.toHaveAttribute("aria-invalid", "true");
  await start.click();
  const summary = page.getByLabel("Merge completion summary");
  await expect(summary).toBeVisible();
  await expect(page.getByRole("button", { name: "Export merged PBF" })).toBeVisible();
  // Counts are right-aligned numeric cells.
  const counts = summary.getByRole("table", { name: "Applied matching actions" });
  await expect(counts.locator('[data-numeric="true"]')).toHaveText(["1", "1", "0", "0", "0"]);
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
  await expect(baseSection.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(patchSection.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(baseSection).not.toContainText("completion-base.pbf");
  await expect(patchSection).not.toContainText("completion-patch.pbf");
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
  // Row choices collect until applied together; the plan cannot be applied meanwhile.
  const include = removal.getByRole("radio", { name: "Include", exact: true });
  await include.click();
  await expect(include).toBeChecked();
  await expect(removal).toContainText("Choice not applied yet");
  const applyPlan = page.getByRole("button", { name: "Apply plan", exact: true });
  await expect(applyPlan).toBeDisabled();
  await page.getByRole("button", { name: "Apply 1 choice", exact: true }).click();
  await expect(feature).toContainText("Removed");
  await expect(removal).not.toContainText("Choice not applied yet");
  await applyPlan.click();
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

test("choices are saved for the files, offered back, exported and imported", async ({ page }) => {
  const { base, patch } = createWayRemovalInputs();
  await openTinyMerge(page, {
    base: {
      name: "saved-base.pbf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(await toPbfBuffer(base)),
    },
    patch: {
      name: "saved-patch.pbf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(await toPbfBuffer(patch)),
    },
  });
  await page.getByRole("checkbox", { name: "Enable proximity matching" }).check();
  await page.getByRole("checkbox", { name: "Copy tags", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Review redundant way removal" }).check();
  const reviewPlan = page.getByRole("button", { name: "Review plan" });
  await reviewPlan.click();
  const removal = () =>
    page
      .getByRole("region", { name: "Imported way 20", exact: true })
      .locator('[data-proposal-id="remove:w20>w10"]');
  await removal().getByRole("radio", { name: "Include", exact: true }).click();
  await page.getByRole("button", { name: "Apply 1 choice", exact: true }).click();
  await expect(removal()).toContainText("In the plan");

  // Leaving the review keeps the choice; planning the same files again offers it back.
  await page.getByRole("button", { name: "Back to inputs" }).click();
  await reviewPlan.click();
  await expect(page.getByText("1 choice saved from your last review of these files")).toBeVisible();
  await expect(removal()).not.toContainText("In the plan");
  await page.getByRole("button", { name: "Restore 1 choice", exact: true }).click();
  await expect(removal()).toContainText("In the plan");

  // Export, undo the choice, and import it back.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export choices (.json)" }).click();
  const exported = await (await download).path();
  if (!exported) throw Error("Missing choices download");
  expect(JSON.parse(await readFile(exported, "utf8"))).toMatchObject({
    format: "osmix-merge-decisions",
    decisions: [{ proposalId: "remove:w20>w10", action: "accept" }],
  });
  await removal().getByRole("radio", { name: "Decide later", exact: true }).click();
  await page.getByRole("button", { name: "Apply 1 choice", exact: true }).click();
  await expect(removal()).not.toContainText("In the plan");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import choices" }).click();
  await (await chooser).setFiles(exported);
  await expect(removal()).toContainText("In the plan");
});

test("a late cancellation preserves the committed exact result and replacing the base clears completion", async ({
  page,
}) => {
  const inputs = await tinyInputs();
  const { baseSection } = await openTinyMerge(page, inputs);
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
  // into it. "Swap base and patch" is the explicit move. Either way the base dataset changes,
  // which must invalidate the completed merge.
  await page.getByRole("button", { name: "Clear merged OSM" }).click();
  await loadPbf(baseSection, page, inputs.base);
  await expect(page.getByRole("heading", { name: /^1\.\s*Choose the inputs$/ })).toBeVisible();
  await expect(summary).toHaveCount(0);
  await expect(baseSection.getByRole("button", { name: "File info" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export merged PBF" })).toHaveCount(0);
});

test("swapping exchanges the inputs, or moves the only one, without reloading", async ({
  page,
}) => {
  const inputs = await tinyInputs();
  const { baseSection, patchSection } = await openTinyMerge(page, inputs);
  const fileName = (section: Locator) => section.locator('[data-slot="osm-input-file-name"]');
  const swap = page.getByRole("button", { name: "Swap base and patch" });
  // Each slot's worker dataset is `<slot>-<file hash>`.
  const hashes = await page.evaluate(
    async ([base, patch]) => ({
      base: await window.osmWorker.hashBuffer(new Uint8Array(base).buffer),
      patch: await window.osmWorker.hashBuffer(new Uint8Array(patch).buffer),
    }),
    [[...inputs.base.buffer], [...inputs.patch.buffer]],
  );
  const has = (id: string) => page.evaluate((osmId) => window.osmWorker.has(osmId), id);

  await swap.click();
  await expect(fileName(baseSection)).toHaveText("completion-patch.pbf");
  await expect(fileName(patchSection)).toHaveText("completion-base.pbf");
  await expect.poll(() => has(`base-${hashes.patch}`)).toBe(true);
  await expect.poll(() => has(`patch-${hashes.base}`)).toBe(true);
  // The datasets the slots held before are freed.
  await expect.poll(() => has(`base-${hashes.base}`)).toBe(false);
  await expect.poll(() => has(`patch-${hashes.patch}`)).toBe(false);

  // With one input loaded, the swap moves it into the empty slot.
  await baseSection.getByRole("button", { name: "Clear base OSM file" }).click();
  await expect(fileName(baseSection)).toHaveCount(0);
  await swap.click();
  await expect(fileName(baseSection)).toHaveText("completion-base.pbf");
  await expect(fileName(patchSection)).toHaveCount(0);
  await expect(patchSection.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect.poll(() => has(`patch-${hashes.base}`)).toBe(false);
  await expect(page.getByRole("button", { name: "Review plan" })).toBeDisabled();
});
