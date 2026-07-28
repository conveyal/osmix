import { expect, test } from "@playwright/test";

test("loads the authoritative base directly from the Merge tab", async ({ page }) => {
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
  await expect(patchCard.getByRole("button", { name: "Open from URL" })).toBeVisible();
});
