import { expect, type Locator, type Page, test } from "@playwright/test";

const readState = (page: Page) => page.evaluate(() => window.planReviewHarness.readState());
const outcome = (page: Page, featureKey: string) =>
  page.evaluate((key) => window.planReviewHarness.outcome(key), featureKey);
const review = (page: Page) => page.getByTestId("plan-review-harness");
const feature = (page: Page, name: string) =>
  review(page).getByRole("region", { name, exact: true });

async function expectContained(locator: Locator) {
  expect(await locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/plan-review-harness.html");
  await expect(review(page)).toBeVisible();
});

test("input sections and plan actions stay contained at supported sidebar widths", async ({
  page,
}) => {
  for (const width of [448, 512]) {
    await page.setViewportSize({ width: width + 16, height: 900 });
    await expectContained(page.getByTestId("input-card-harness"));
    const actions = page.getByRole("group", { name: "Plan actions" });
    await expectContained(actions);
    await expectContained(review(page));
  }
});

test("matching settings expose names, help, and field-specific errors", async ({ page }) => {
  const settings = page.getByRole("region", { name: "Match imported data", exact: true });
  const enable = settings.getByRole("checkbox", { name: "Enable proximity matching" });
  await enable.focus();
  await enable.press("Space");
  await expect(enable).toBeChecked();
  const keys = settings.getByRole("textbox", { name: "OSM tag keys to copy" });
  const radius = settings.getByRole("spinbutton", { name: "Candidate search radius (meters)" });
  await keys.fill("");
  await expect(keys).toHaveAttribute("aria-invalid", "true");
  await expect(keys).toHaveAccessibleDescription(/Enter at least one OSM tag key/);
  await keys.fill("name surface");
  await expect(keys).not.toHaveAttribute("aria-invalid", "true");
  await radius.fill("0");
  await expect(radius).toHaveAttribute("aria-invalid", "true");
  await expect(radius).toHaveAccessibleDescription(/greater than zero/);
  const identical = page.getByRole("checkbox", {
    name: "Merge points at identical coordinates automatically",
  });
  await expect(identical).toBeChecked();
  await expect(identical).toHaveAccessibleDescription(/waits for your decision/);
});

test("choices on a feature replan it, and removal waits for its connections", async ({ page }) => {
  const trunk = feature(page, "Imported way 20");
  await expect(trunk).toContainText("Needs decision");
  const removal = trunk.locator('[data-proposal-id="remove:w20>w10"]');
  await expect(removal).toContainText("Blocked");
  await expect(removal).toContainText("Accept the required connections before removal");
  await expect(removal.getByRole("radio")).toHaveCount(0);

  for (const proposalId of ["connect:n101>n1", "connect:n102>n2"]) {
    await trunk
      .locator(`[data-proposal-id="${proposalId}"]`)
      .getByRole("radio", { name: "Include", exact: true })
      .check();
  }
  // With both connections included, removal becomes a choice.
  const include = removal.getByRole("radio", { name: "Include", exact: true });
  await expect(include).toBeVisible();
  await include.check();
  await expect(removal).toContainText("In the plan");
  expect((await readState(page)).decisions).toContainEqual({
    proposalId: "remove:w20>w10",
    action: "accept",
  });
  // Copying the name still waits for a choice, so the feature still needs a decision.
  await trunk
    .locator('[data-proposal-id="copy:w20>w10"]')
    .getByRole("radio", { name: "Leave out", exact: true })
    .check();
  await expect.poll(async () => outcome(page, "way:20")).toBe("removed");

  await removal.getByRole("radio", { name: "Decide later", exact: true }).check();
  await expect
    .poll(async () => (await readState(page)).decisions.map(({ proposalId }) => proposalId))
    .not.toContain("remove:w20>w10");
});

test("filters narrow the rows and bulk choices apply to what is shown", async ({ page }) => {
  await review(page)
    .getByLabel("Proposal", { exact: true })
    .selectOption({ label: "Connect network" });
  // Both connections are on way 20: a shared vertex belongs to the first way that uses it.
  await expect(review(page).getByRole("region", { name: /^Imported way/ })).toHaveCount(1);
  // Counts are in features: both connections are on the one imported way.
  await review(page).getByRole("button", { name: "Include 1 feature" }).click();
  await expect
    .poll(async () => (await readState(page)).decisions.map(({ action }) => action))
    .toEqual(["accept", "accept"]);
  await review(page).getByRole("button", { name: "Clear choices for 1 feature" }).click();
  await expect.poll(async () => (await readState(page)).decisions).toEqual([]);
  await review(page).getByLabel("Outcome", { exact: true }).selectOption({ label: "Removed" });
  await expect(review(page)).toContainText("No imported features match these filters");
});

test("opening a feature shows its match evidence", async ({ page }) => {
  const trunk = feature(page, "Imported way 20");
  await trunk.getByRole("button", { name: "Show on map and evidence" }).click();
  await expect(trunk.getByRole("button", { name: "Showing on map" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    trunk.getByRole("button", { name: "Match evidence and attributes" }).first(),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(trunk).toContainText(/0\.\d{3} m/);
});

test("the patch ID notice counts replaced base entities and replans every feature as new", async ({
  page,
}) => {
  await review(page).getByRole("button", { name: "Load patch ID fixture" }).click();
  const notice = review(page).getByText("2 patch entities replace base entities");
  await expect(notice).toBeVisible();
  await expect.poll(async () => outcome(page, "node:1")).toBe("replaced");
  await review(page).getByRole("checkbox", { name: "Treat all as new" }).check();
  await expect(review(page).getByText("Every patch feature is read as new")).toBeVisible();
  await expect.poll(async () => outcome(page, "node:1")).toBe("added");
});

test("finite, unavailable, and unmatched distances remain distinct", async ({ page }) => {
  const evidence = page.getByTestId("evidence-harness");
  // Evidence starts open.
  for (const summary of await evidence
    .getByRole("button", { name: "Match evidence and attributes" })
    .all()) {
    await expect(summary).toHaveAttribute("aria-expanded", "true");
  }
  await expect(evidence.getByRole("region", { name: "Finite distance" })).toContainText("0.452 m");
  await expect(evidence.getByRole("region", { name: "Unavailable distance" })).toContainText(
    "Distance unavailable for this target",
  );
  await expect(evidence.getByRole("region", { name: "No eligible target" })).toContainText(
    "No eligible base target within search radius",
  );
  await expect(evidence).not.toContainText(/Infinity|NaN/);
});
