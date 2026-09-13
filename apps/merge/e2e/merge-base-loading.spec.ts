import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { Osm, toPbfBuffer } from "osmix";

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
  await page.getByRole("tab", { name: "Merge" }).click();

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
  await expect(baseCard.getByRole("button", { name: "Download base OSM" })).toBeVisible();
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
  await expect(patchCard.getByRole("button", { name: "Download patch OSM" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Clear patch OSM file" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Save to storage" })).toHaveCount(0);
  await patchCard.getByRole("button", { name: "File info" }).click();
  await expect(patchCard.getByRole("row").filter({ hasText: "file name" })).toContainText(
    "monaco.pbf",
  );

  await page.getByRole("button", { name: /Review each merge stage/ }).click();
  await expect(page.getByText(/2: Inspect base OSM/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip base diagnostic" })).toBeVisible();

  await page.getByRole("button", { name: "Skip base diagnostic" }).click();
  await expect(page.getByText(/4: Inspect patch OSM/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip patch diagnostic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download JSON changes" })).toHaveCount(0);

  await page.getByRole("button", { name: "Skip patch diagnostic" }).click();
  await expect(page.getByText(/6: Direct merge/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview direct merge" })).toBeVisible();

  await page.getByRole("button", { name: "Preview direct merge" }).click();
  await expect(page.getByText(/Review direct merge/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue to matching and reconciliation" }).click();
  await expect(page.getByText(/Reconcile matching entities/i)).toBeVisible();

  const reconciliationActions = page.getByRole("group", {
    name: "Exact reconciliation actions",
  });
  const withoutExact = reconciliationActions.getByRole("button", {
    name: "Preview without exact reconciliation",
  });
  const withExact = reconciliationActions.getByRole("button", {
    name: "Preview with exact reconciliation",
  });

  await withoutExact.focus();
  await expect(withoutExact).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(withExact).toBeFocused();
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
  await page.getByRole("tab", { name: "Merge" }).click();
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
  const start = page.getByRole("button", { name: /Run automatic merge/ });
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
  await page.getByRole("button", { name: /Run automatic merge/ }).click();
  const summary = page.getByLabel("Merge completion summary");
  await expect(summary).toBeVisible();
  await expect(page.getByRole("button", { name: "Download merged OSM PBF" })).toBeVisible();
  await expect(summary.getByLabel("Applied matching actions").locator("dd")).toHaveText([
    "1",
    "1",
    "0",
    "0",
  ]);
  await expect(summary).toContainText("completion-base.pbf + completion-patch.pbf");
  const downloadPromise = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Download merge report" }).click();
  const reportFile = await (await downloadPromise).path();
  if (!reportFile) throw Error("Missing automatic merge report download");
  expect(JSON.parse(await readFile(reportFile, "utf8"))).toMatchObject({
    format: "osmix-merge-outcome",
    version: 1,
    outcome: {
      stage: "matching-before-intersections",
      summary: { tagCopyActions: 1, unresolvedFeatures: 0 },
      features: [{ entityType: "node", sourceId: 101, copiedKeys: ["name"] }],
    },
  });
  await page.getByRole("button", { name: "Start a new merge" }).click();
  await expect(page.getByText("Select merge inputs and options", { exact: false })).toBeVisible();
  await expect(summary).toHaveCount(0);
  await expect(baseCard.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(baseCard).not.toContainText("completion-base.pbf");
  await expect(patchCard).not.toContainText("completion-patch.pbf");
});

test("a late cancellation preserves the committed exact result and a new extracted base clears completion", async ({
  page,
}) => {
  const inputs = await tinyInputs();
  const { baseCard } = await openTinyMerge(page, inputs);
  // Hold only the return after the real worker commits, so cancellation exercises
  // the actual irreversible boundary without racing a tiny fixture's parse time.
  await page.evaluate(() => {
    const remote = window.osmWorker;
    const merge = remote.merge.bind(remote);
    remote.merge = async (...args) => {
      const result = await merge(...args);
      const get = remote.get.bind(remote);
      let refreshFailures = 2;
      remote.get = async (osmId) => {
        if (osmId === result.id && refreshFailures > 0) {
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
  await page.getByRole("button", { name: /Run automatic merge/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-test-merge-committed", "true");
  await page.getByRole("button", { name: "Request cancellation" }).click();
  await page.evaluate(() => document.dispatchEvent(new Event("test-release-merge")));
  const summary = page.getByLabel("Merge completion summary");
  await expect(page.getByRole("alert")).toContainText("Injected completed-result refresh failure");
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Run automatic merge/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download merged OSM PBF" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh merged dataset" }).click();
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Imported-data matching was not enabled");
  await expect(page.getByRole("button", { name: "Download merged OSM PBF" })).toBeVisible();

  await page.getByRole("tab", { name: "Extract", exact: true }).click();
  await page.getByLabel("Paste bbox", { exact: false }).fill("-0.002,-0.002,0.002,0.002");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Select PBF", exact: true }).click();
  await (await chooserPromise).setFiles(inputs.base);
  await page.getByRole("button", { name: "Extract", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use as base OSM" })).toBeEnabled();
  await page.getByRole("button", { name: "Use as base OSM" }).click();
  await page.getByRole("tab", { name: "Merge", exact: true }).click();
  await expect(page.getByText("Select merge inputs and options", { exact: false })).toBeVisible();
  await expect(summary).toHaveCount(0);
  await expect(baseCard.getByRole("button", { name: "File info" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download merged OSM PBF" })).toHaveCount(0);
});
