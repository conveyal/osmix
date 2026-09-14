import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function state(page: Page) {
  return page.evaluate(() => window.removalHarness.readState());
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  for (const width of [320, 512]) {
    await page.setViewportSize({ width, height: 1200 });
    const panel = page.getByTestId("removal-harness");
    await expect
      .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/guidance-harness.html?removal");
  await expect(page.getByTestId("removal-harness")).toBeVisible();
});

test("explicit removal keeps keyboard focus and requires a generated preview before application", async ({
  page,
}, testInfo) => {
  const feature = page.getByRole("region", { name: "Imported way 20", exact: true });
  const removal = feature.getByRole("checkbox", { name: "Remove imported way", exact: true });
  const copy = feature.getByRole("checkbox", { name: "Copy tags", exact: true });
  await expect(removal).not.toBeChecked();
  await expect(feature).toContainText("Newly orphaned points to remove: 101, 102");
  await expect(feature).toContainText("Removing this way also removes its remaining attributes");
  await expect(page.getByRole("button", { name: /^Remove imported way/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Delay next choice" }).click();
  await removal.focus();
  await removal.press("Space");
  await expect(removal).toHaveAttribute("aria-disabled", "true");
  await expect(removal).toBeFocused();
  await removal.press("Space");
  expect((await state(page)).decisionCalls).toBe(1);
  await page.evaluate(() => window.removalHarness.finishChoice());
  await expect(removal).toBeChecked();
  await expect(removal).toBeFocused();
  await removal.press("Space");
  await expect(removal).not.toBeChecked();
  await expect(removal).toBeFocused();
  await removal.press("Space");
  await expect(removal).toBeChecked();

  await copy.focus();
  await copy.press("Space");
  await expect(removal).toBeChecked();
  await page.getByRole("button", { name: "Generate removal preview" }).click();
  const preview = page.getByRole("region", { name: "Way removal preview", exact: true });
  await expect(preview).toContainText("Imported ways to remove: 1");
  await expect(preview).toContainText("The dataset changes only when you apply");
  expect(await state(page)).toMatchObject({
    baseWayIds: [10],
    patchWayPresent: true,
    applied: false,
  });
  await capture(page, testInfo, "standalone-removal-preview");

  await page.getByRole("button", { name: "Apply previewed merge" }).click();
  await expect(
    page.getByRole("region", { name: "Applied way removals", exact: true }),
  ).toBeVisible();
  expect(await state(page)).toMatchObject({
    baseWayIds: [10],
    baseNodeIds: [1, 2, 103],
    applied: true,
  });
});

test("blocked branch removal becomes eligible only after an explicit connection and refreshes its preview", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Branching removal", exact: true }).click();
  const feature = page.getByRole("region", { name: "Imported way 20", exact: true });
  const removal = feature.getByRole("checkbox", { name: "Remove imported way", exact: true });
  await expect(removal).toBeDisabled();
  await expect(feature).toContainText("Select the required branch connections before removal");
  await expect(feature).toContainText("retained ways 30");
  await capture(page, testInfo, "blocked-branch-removal");
  await feature.getByRole("button", { name: "Review connection at imported point 102" }).click();
  const connection = page.getByRole("region", { name: "Imported node 102", exact: true });
  await expect(
    connection.getByRole("checkbox", { name: "Connect network", exact: true }),
  ).toBeChecked();
  await connection.getByRole("button", { name: "Confirm connection for removal" }).click();
  await expect
    .poll(
      async () =>
        (await state(page)).decisions.find((decision) => decision.candidateId === "node:102->2")
          ?.attachNetwork,
    )
    .toBe(true);
  await page.getByRole("button", { name: "Show all imported features" }).click();
  await expect(removal).toBeEnabled();
  await removal.click();
  await expect(removal).toBeChecked();
  await page.getByRole("button", { name: "Generate removal preview" }).click();
  const preview = page.getByRole("region", { name: "Way removal preview", exact: true });
  await expect(preview).toContainText("Explicit network connection selected");
  await expect(preview).toContainText("retained ways 30 → base point 2");
  await capture(page, testInfo, "connected-branch-removal-preview");
  const copy = feature.getByRole("checkbox", { name: "Copy tags", exact: true });
  await copy.click();
  await expect(copy).not.toBeChecked();
  await expect(preview).toHaveCount(0);
  await expect(removal).toBeChecked();
  await page.getByRole("button", { name: "Generate removal preview" }).click();
  await page.getByRole("button", { name: "Apply previewed merge" }).click();
  expect(await state(page)).toMatchObject({
    baseWayIds: [10, 30],
    branchRefs: [2, 103],
    applied: true,
  });
});

test("removal preserves tagged points and shows them separately from orphan cleanup", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Tagged point removal" }).click();
  const feature = page.getByRole("region", { name: "Imported way 20", exact: true });
  await expect(feature).toContainText("Newly orphaned points to remove: 102");
  await expect(feature).toContainText("Tagged imported points retained: 101");
  const removal = feature.getByRole("checkbox", { name: "Remove imported way", exact: true });
  await removal.click();
  await expect(removal).toBeChecked();
  await page.getByRole("button", { name: "Generate removal preview" }).click();
  await page.getByRole("button", { name: "Apply previewed merge" }).click();
  expect(await state(page)).toMatchObject({
    baseWayIds: [10],
    baseNodeIds: [1, 2, 101, 103],
    applied: true,
  });
});
