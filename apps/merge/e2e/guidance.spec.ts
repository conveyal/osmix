import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

interface HarnessState {
  decision: string;
  inputs: {
    baseDownloads: number;
    baseLoaded: boolean;
    patchDownloads: number;
    patchLoaded: boolean;
  };
  propertyKeys: string;
  workerCalls: number;
  workflowStep: string;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/guidance-harness.html");
});

test("guidance starts collapsed and supports mouse and keyboard disclosure", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "How this step works" });
  const details = page.locator('[data-slot="merge-step-guide-details"]');

  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(details).toBeHidden();

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(details).toBeVisible();
  await expect(details.getByRole("heading", { level: 3 })).toHaveCount(4);

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.focus();
  await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  await trigger.press("Space");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("opening help leaves merge inputs, decisions, workflow state, and worker calls unchanged", async ({
  page,
}) => {
  const readState = () => page.evaluate<HarnessState>(() => window.guidanceHarness.readState());
  const before = await readState();
  const trigger = page.getByRole("button", { name: "How this step works" });

  await trigger.click();
  await trigger.press("Enter");
  await trigger.press("Space");

  await expect(page.getByLabel("OSM tag keys to transfer")).toHaveValue(before.propertyKeys);
  await expect(page.getByTestId("workflow-state")).toContainText(before.workflowStep);
  await expect(page.getByTestId("workflow-state")).toContainText(before.decision);
  expect(await readState()).toEqual(before);
});

test("info tooltips reveal long guidance on hover and keyboard activation", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "About candidate statuses" });
  const tooltip = page.locator('[data-slot="info-tooltip-content"]');

  await expect(tooltip).toBeHidden();
  await trigger.hover();
  await expect(tooltip).toContainText("Automatic matches apply unless rejected");

  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();

  await trigger.focus();
  await trigger.press("Enter");
  await expect(tooltip).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("automatic merge progress advances completed, running, and remaining steps", async ({
  page,
}) => {
  const progress = page.getByRole("list", { name: "Automatic merge progress" });

  await expect(page.locator('[data-slot="automatic-merge-elapsed"]')).toHaveText("9:42");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(progress.locator('[data-status="completed"]')).toHaveCount(0);
  await expect(progress.locator('[data-status="running"]')).toContainText(
    "Discover imported-data matches",
  );
  await expect(
    progress.locator('[data-status="running"] [data-slot="automatic-merge-latest-message"]'),
  ).toContainText("Worker message for Discover imported-data matches");
  await expect(progress.locator('[data-status="remaining"]')).toHaveCount(4);

  await page.getByRole("button", { name: "Advance automatic merge" }).click();

  await expect(progress.locator('[data-status="completed"]')).toHaveCount(1);
  await expect(progress.locator('[data-status="running"]')).toContainText(
    "Generate and validate merge changes",
  );
  await expect(
    progress.locator('[data-status="running"] [data-slot="automatic-merge-latest-message"]'),
  ).toContainText("Worker message for Generate and validate merge changes");
  await expect(page.getByRole("status")).toContainText("1 of 5 steps completed");
});

test("loaded input cards remain usable and contained without loading a PBF", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const harness = page.getByTestId("input-card-harness");
  const baseCard = harness
    .locator('[data-slot="card"]')
    .filter({ hasText: "Base OSM — authoritative existing dataset" });
  const patchCard = harness
    .locator('[data-slot="card"]')
    .filter({ hasText: "Patch OSM — imported additions and updates" });
  const longBaseName =
    "an-extremely-long-base-osm-filename-that-must-not-push-actions-outside-the-card.pbf";

  await expect(baseCard.locator('[data-slot="card-description"]')).toHaveText(longBaseName);
  await expect(baseCard.locator('[data-slot="card-description"]')).toHaveAttribute(
    "title",
    longBaseName,
  );
  await expect(baseCard.getByRole("button", { name: "Download base OSM" })).toBeVisible();
  await expect(baseCard.getByRole("button", { name: "Clear base OSM file" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Download patch OSM" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Clear patch OSM file" })).toBeVisible();
  await expect(patchCard.getByRole("button", { name: "Save to storage" })).toHaveCount(0);
  await expect
    .poll(() => harness.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);

  await baseCard.getByRole("button", { name: "Download base OSM" }).click();
  await patchCard.getByRole("button", { name: "Download patch OSM" }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.guidanceHarness.readState())).inputs)
    .toMatchObject({ baseDownloads: 1, patchDownloads: 1 });

  await baseCard.getByRole("button", { name: "Clear base OSM file" }).click();
  await expect(baseCard.getByRole("button", { name: "Open base OSM" })).toBeVisible();
  await expect(baseCard.locator('[data-slot="card-description"]')).toHaveCount(0);
  await expect(patchCard.locator('[data-slot="card-description"]')).toHaveText("monaco.test.pbf");

  await patchCard.getByRole("button", { name: "Clear patch OSM file" }).click();
  await expect(patchCard.getByRole("button", { name: "Open patch OSM" })).toBeVisible();
  await expect(patchCard.locator('[data-slot="card-description"]')).toHaveCount(0);
});

test("workflow step actions remain contained at supported sidebar widths", async ({ page }) => {
  for (const width of [320, 512]) {
    await page.setViewportSize({ width, height: 900 });
    const actionGroups = page.getByRole("group", { name: /step actions$/i });
    await expect(actionGroups).toHaveCount(3);

    for (const actionGroup of await actionGroups.all()) {
      const measurements = await actionGroup.evaluate((group) => {
        const groupBounds = group.getBoundingClientRect();
        const buttons = [...group.querySelectorAll<HTMLElement>('[data-slot="button"]')];
        const buttonBounds = buttons.map((button) => button.getBoundingClientRect());
        return {
          buttons: buttonBounds.map((bounds) => ({
            bottom: bounds.bottom,
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
          })),
          clientWidth: group.clientWidth,
          groupLeft: groupBounds.left,
          groupRight: groupBounds.right,
          scrollWidth: group.scrollWidth,
        };
      });

      expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.clientWidth);
      expect(measurements.buttons).toHaveLength(2);
      expect(measurements.buttons[0].left).toBeGreaterThanOrEqual(measurements.groupLeft);
      expect(measurements.buttons[0].right).toBeLessThanOrEqual(measurements.groupRight);
      expect(measurements.buttons[1].left).toBeGreaterThanOrEqual(measurements.groupLeft);
      expect(measurements.buttons[1].right).toBeLessThanOrEqual(measurements.groupRight);
      expect(measurements.buttons[1].top).toBeGreaterThan(measurements.buttons[0].bottom);
    }

    const reconciliationActions = page.getByRole("group", {
      name: "Reconciliation step actions",
    });
    const secondaryAction = reconciliationActions.getByRole("button", {
      name: "Preview without exact reconciliation",
    });
    const primaryAction = reconciliationActions.getByRole("button", {
      name: "Preview with exact reconciliation",
    });
    await expect(secondaryAction).toHaveClass(/border/);
    await expect(primaryAction).toHaveClass(/bg-primary/);
    await secondaryAction.focus();
    await expect(secondaryAction).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(primaryAction).toBeFocused();
  }
});

test("guidance and diagrams remain contained at supported sidebar widths", async ({ page }) => {
  for (const width of [320, 512]) {
    await page.setViewportSize({ width, height: 800 });
    const trigger = page.getByRole("button", { name: "How this step works" });
    if ((await trigger.getAttribute("aria-expanded")) === "false") await trigger.click();

    const diagram = page.locator('[data-slot="merge-step-guide"] svg[data-diagram]');
    await expect(diagram).toHaveCount(1);
    await expect(diagram).toBeVisible();

    const measurements = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>('[data-testid="guidance-sidebar"]');
      const svg = document.querySelector<SVGElement>(
        '[data-slot="merge-step-guide"] svg[data-diagram]',
      );
      if (!sidebar || !svg) throw new Error("Guidance harness did not render");

      const sidebarBounds = sidebar.getBoundingClientRect();
      const svgBounds = svg.getBoundingClientRect();
      const diagramTextHeights = [...svg.querySelectorAll("text")].map(
        (label) => label.getBoundingClientRect().height,
      );
      return {
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        minimumDiagramTextHeight: Math.min(...diagramTextHeights),
        sidebarLeft: sidebarBounds.left,
        sidebarRight: sidebarBounds.right,
        svgHeight: svgBounds.height,
        svgLeft: svgBounds.left,
        svgRight: svgBounds.right,
      };
    });

    expect(measurements.documentScrollWidth).toBeLessThanOrEqual(measurements.documentClientWidth);
    expect(measurements.minimumDiagramTextHeight).toBeGreaterThanOrEqual(9);
    expect(measurements.svgHeight).toBeLessThanOrEqual(330);
    expect(measurements.svgLeft).toBeGreaterThanOrEqual(measurements.sidebarLeft);
    expect(measurements.svgRight).toBeLessThanOrEqual(measurements.sidebarRight);
  }
});

test.describe("matching action review", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/guidance-harness.html?conflation");
    await expect(page.getByTestId("conflation-review-harness")).toBeVisible();
  });

  const readState = (page: Page) => page.evaluate(() => window.conflationReviewHarness.readState());
  const harness = (page: Page) => page.getByTestId("conflation-review-harness");
  const actions = (page: Page) =>
    harness(page).getByRole("group", { name: "Matching actions for imported node 101" });
  const row = (page: Page) =>
    harness(page)
      .locator('[data-slot="item"]')
      .filter({ hasText: "Imported node 101 → Base node 1" });

  async function choose(page: Page, name: "Copy tags" | "Connect network", selected: boolean) {
    const control = actions(page).getByRole("checkbox", { name, exact: true });
    await expect(control).toBeChecked({ checked: !selected });
    await control.click();
    // The controlled checkbox updates after its asynchronous worker action commits.
    await expect(control).toBeChecked({ checked: selected });
  }

  async function expectChoices(page: Page, copy: boolean, connect: boolean) {
    await expect(
      actions(page).getByRole("checkbox", { name: "Copy tags", exact: true }),
    ).toBeChecked({ checked: copy });
    await expect(
      actions(page).getByRole("checkbox", { name: "Connect network", exact: true }),
    ).toBeChecked({ checked: connect });
    const status = row(page).locator('[aria-label="Scheduled matching actions"]');
    await expect(status).toContainText(`Copy tags: ${copy ? "Scheduled" : "Not selected"}`);
    await expect(status).toContainText(
      `Connect network: ${connect ? "Scheduled" : "Not selected"}`,
    );
  }

  async function expectRequest(page: Page, copy: boolean, connect: boolean) {
    await expect
      .poll(async () => (await readState(page)).requests.at(-1))
      .toEqual({
        kind: "decision",
        decision: {
          candidateId: "node:101->1",
          action: "accept",
          transferProperties: copy,
          attachNetwork: connect,
        },
      });
  }

  async function expectPreview(page: Page, copy: boolean, connect: boolean) {
    await harness(page)
      .getByRole("button", { name: "Preview current choices", exact: true })
      .click();
    await expect(harness(page).getByTestId("preview-name")).toHaveText(
      copy ? "Imported entrance" : "Base entrance",
    );
    await expect(harness(page).getByTestId("preview-refs")).toHaveText(
      connect ? "1, 102" : "101, 102",
    );
    const before = await readState(page);
    await harness(page)
      .getByRole("button", { name: "Regenerate current preview", exact: true })
      .click();
    await expect.poll(async () => (await readState(page)).generations).toBe(before.generations + 1);
    expect((await readState(page)).preview).toEqual(before.preview);
    await harness(page).getByRole("button", { name: "Back to match review", exact: true }).click();
  }

  test("independent choices, skipping, and resetting agree with worker previews", async ({
    page,
  }) => {
    await expectChoices(page, true, true);
    await choose(page, "Connect network", false);
    await expectChoices(page, true, false);
    await expectRequest(page, true, false);
    await harness(page).getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      harness(page).getByRole("group", { name: "Matching actions for imported node 102" }),
    ).toBeVisible();
    await harness(page).getByRole("button", { name: "Previous", exact: true }).click();
    await expectChoices(page, true, false);
    await expectPreview(page, true, false);

    await choose(page, "Copy tags", false);
    await choose(page, "Connect network", true);
    await expectChoices(page, false, true);
    await expectRequest(page, false, true);
    await expectPreview(page, false, true);

    const copyControl = actions(page).getByRole("checkbox", { name: "Copy tags", exact: true });
    await copyControl.focus();
    await copyControl.press("Space");
    await expectChoices(page, true, true);
    await expectRequest(page, true, true);
    await expectPreview(page, true, true);

    await choose(page, "Copy tags", false);
    await choose(page, "Connect network", false);
    await expectChoices(page, false, false);
    await expectRequest(page, false, false);
    await expect(row(page).locator('[data-slot="item-description"]')).toContainText("Skipped");
    await expect(actions(page)).toContainText("Ordinary imported additions are kept");
    await expectPreview(page, false, false);

    await expect(
      actions(page).getByRole("button", { name: "Skip match", exact: true }),
    ).toBeDisabled();
    await choose(page, "Copy tags", true);
    await actions(page).getByRole("button", { name: "Skip match", exact: true }).click();
    await expectChoices(page, false, false);
    await expect
      .poll(async () => (await readState(page)).requests.at(-1))
      .toEqual({ kind: "decision", decision: { candidateId: "node:101->1", action: "reject" } });
    await expectPreview(page, false, false);
    await actions(page).getByRole("button", { name: "Use automatic choices", exact: true }).click();
    await expectChoices(page, true, true);
    await expect
      .poll(async () => (await readState(page)).requests.at(-1))
      .toEqual({ kind: "reset", candidateId: "node:101->1", decisions: [] });
    await expect(row(page).locator('[aria-label="Scheduled matching actions"]')).toContainText(
      "Scheduled automatically",
    );
  });

  test("bulk copy preserves the other choice and bulk skip clears both", async ({ page }) => {
    await actions(page).getByRole("button", { name: "Skip match", exact: true }).click();
    await choose(page, "Copy tags", true);
    await expectChoices(page, true, false);
    const rowDecision = (await readState(page)).decisions[0];
    await expectPreview(page, true, false);

    await harness(page)
      .getByRole("button", { name: "Load compatible fixture", exact: true })
      .click();
    await actions(page).getByRole("button", { name: "Skip match", exact: true }).click();
    await harness(page).getByRole("button", { name: "Copy tags (1)", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Keep each network connection choice unchanged");
    await dialog.getByRole("button", { name: "Copy tags (1)", exact: true }).click();
    await expectChoices(page, true, false);
    expect((await readState(page)).decisions[0]).toEqual(rowDecision);
    await expectPreview(page, true, false);

    await harness(page).getByRole("button", { name: "Skip filtered (2)", exact: true }).click();
    await expect(dialog).toContainText("Schedule no matching actions");
    await expect(dialog).not.toContainText("other action stays");
    await dialog.getByRole("button", { name: "Skip filtered matches (2)", exact: true }).click();
    await expectChoices(page, false, false);
    await expect
      .poll(async () => (await readState(page)).requests.at(-1))
      .toEqual({ kind: "bulk", request: { action: "reject", filter: { entityType: "node" } } });
    await expectPreview(page, false, false);
  });

  test("blocked connections stay disabled while copying and resetting remain available", async ({
    page,
  }) => {
    await harness(page)
      .getByRole("button", { name: "Load blocked connection fixture", exact: true })
      .click();
    const connect = actions(page).getByRole("checkbox", { name: "Connect network", exact: true });
    await expect(connect).toBeDisabled();
    await expect(connect).not.toBeChecked();
    await expect(connect).toHaveAccessibleDescription(/Blocked: Routing uses are incompatible/);
    await expect(
      actions(page).getByRole("checkbox", { name: "Copy tags", exact: true }),
    ).toBeChecked();
    await expect(row(page).locator('[aria-label="Scheduled matching actions"]')).toContainText(
      "Connect network: Blocked",
    );
    await expectPreview(page, true, false);
    await actions(page).getByRole("button", { name: "Skip match", exact: true }).click();
    await expect(
      actions(page).getByRole("checkbox", { name: "Copy tags", exact: true }),
    ).not.toBeChecked();
    await expect(connect).toBeDisabled();
    await actions(page).getByRole("button", { name: "Use automatic choices", exact: true }).click();
    await expect(
      actions(page).getByRole("checkbox", { name: "Copy tags", exact: true }),
    ).toBeChecked();
    await expect(connect).toBeDisabled();
    await expect(connect).not.toBeChecked();
  });

  test("pending page navigation disables the previous candidate controls", async ({ page }) => {
    await harness(page)
      .getByRole("button", { name: "Delay next candidate navigation", exact: true })
      .click();
    const before = await readState(page);
    await harness(page).getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      actions(page).getByRole("checkbox", { name: "Copy tags", exact: true }),
    ).toBeDisabled();
    await expect(
      actions(page).getByRole("checkbox", { name: "Connect network", exact: true }),
    ).toBeDisabled();
    await expect(
      harness(page).getByRole("combobox", { name: "Match status", exact: true }),
    ).toBeDisabled();
    expect((await readState(page)).requests).toEqual(before.requests);
    await harness(page)
      .getByRole("button", { name: "Complete delayed page change", exact: true })
      .click();
    await expect(
      harness(page).getByRole("group", { name: "Matching actions for imported node 102" }),
    ).toBeVisible();
    await harness(page).getByRole("button", { name: "Previous", exact: true }).click();
    await expectChoices(page, true, true);
  });

  test("selected actions remain contained at 320 and 512 pixels", async ({ page }) => {
    const artifactDirectory = resolve(
      import.meta.dirname,
      "../../../output/playwright/pr-218-ticket07",
    );
    await mkdir(artifactDirectory, { recursive: true });
    await choose(page, "Connect network", false);
    for (const width of [320, 512]) {
      await page.setViewportSize({ width, height: 1000 });
      const panel = harness(page).getByTestId("conflation-review-panel");
      await expectChoices(page, true, false);
      await expect
        .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth))
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
      const path = resolve(artifactDirectory, `matching-copy-only-${width}.png`);
      await panel.screenshot({ path, animations: "disabled" });
      await test
        .info()
        .attach(`Matching actions at ${width}px`, { path, contentType: "image/png" });
    }
  });
});
