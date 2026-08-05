import { expect, test, type Locator, type Page } from "@playwright/test";

async function loadFromUrl(card: Locator, page: Page, url: string) {
  await card.getByRole("button", { name: "Open from URL" }).click();
  await page.getByRole("textbox", { name: "URL" }).fill(url);
  await page.getByRole("button", { name: "Download and open" }).click();
  await expect(card.getByRole("button", { name: "File info" })).toBeVisible({
    timeout: 120_000,
  });
}

test("loads both inputs once and reaches exact reconciliation", async ({ page }) => {
  // Keep this worker-backed journey to one load per input. Input-card actions,
  // clearing, and responsive geometry run against the production header in the
  // guidance harness instead of repeating PBF parsing and MapLibre resizing here.
  await page.goto("/");
  await page.getByRole("tab", { name: "Merge" }).click();

  const baseCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Base OSM — authoritative existing dataset" })
    .first();
  const patchCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Patch OSM — imported additions and updates" })
    .first();

  await expect(baseCard.getByRole("button", { name: "Open from URL" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Open from URL" })).toBeVisible();

  await loadFromUrl(baseCard, page, "http://127.0.0.1:4173/monaco.pbf");
  await expect(baseCard.locator('[data-slot="card-description"]')).toHaveText("monaco.pbf");
  await expect(baseCard.getByRole("button", { name: "Download base OSM" })).toBeVisible();
  await expect(baseCard.getByRole("button", { name: "Clear base OSM file" })).toBeVisible();
  const fileInfo = baseCard.getByRole("button", { name: "File info" });
  await fileInfo.click();
  await expect(baseCard.getByRole("row").filter({ hasText: "file name" })).toContainText(
    "monaco.pbf",
  );
  await expect(baseCard).toContainText("14,286");

  await loadFromUrl(patchCard, page, "http://127.0.0.1:4173/monaco.test.pbf");
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
