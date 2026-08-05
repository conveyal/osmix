import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

async function loadPbf(card: Locator, page: Page, path: string) {
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
const MONACO_TEST_PBF = fileURLToPath(
  new URL("../../../fixtures/monaco.test.pbf", import.meta.url),
);

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

  await loadPbf(patchCard, page, MONACO_TEST_PBF);
  await expect(patchCard.locator('[data-slot="card-description"]')).toHaveText("monaco.test.pbf");
  await expect(patchCard.getByRole("button", { name: "Download patch OSM" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Clear patch OSM file" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Save to storage" })).toHaveCount(0);
  await patchCard.getByRole("button", { name: "File info" }).click();
  await expect(patchCard.getByRole("row").filter({ hasText: "file name" })).toContainText(
    "monaco.test.pbf",
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
