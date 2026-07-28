import { expect, test } from "@playwright/test";

test("loads both inputs on Merge and skips optional diagnostic scans", async ({ page }) => {
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

  await baseCard.getByRole("button", { name: "Open from URL" }).click();
  await page.getByRole("textbox", { name: "URL" }).fill("http://127.0.0.1:4173/monaco.pbf");
  await page.getByRole("button", { name: "Download and open" }).click();

  const fileInfo = baseCard.getByRole("button", { name: "File info" });
  await expect(fileInfo).toBeVisible({
    timeout: 120_000,
  });
  await fileInfo.click();
  await expect(baseCard).toContainText("14,286");
  await patchCard.getByRole("button", { name: "Open from URL" }).click();
  await page.getByRole("textbox", { name: "URL" }).fill("http://127.0.0.1:4173/monaco.test.pbf");
  await page.getByRole("button", { name: "Download and open" }).click();
  await expect(patchCard.getByRole("button", { name: "File info" })).toBeVisible({
    timeout: 120_000,
  });

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
});
