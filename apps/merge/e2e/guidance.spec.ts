import { mkdir, readFile } from "node:fs/promises";
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
        kind: "source",
        source: { entityType: "node", sourceId: 101 },
        selected: {
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
    await harness(page).getByRole("button", { name: "Back to matching", exact: true }).click();
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
      .toEqual({
        kind: "source",
        source: { entityType: "node", sourceId: 101 },
        selected: { candidateId: "node:101->1", action: "reject" },
      });
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
    await expect(dialog).toContainText("Keep each network connection and removal choice unchanged");
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
    await expect(connect).toHaveAttribute("aria-disabled", "true");
    await expect(
      actions(page)
        .locator("label")
        .filter({ hasText: "Connect network" })
        .locator('input[type="checkbox"]'),
    ).toBeDisabled();
    await expect(connect).not.toBeChecked();
    await expect(connect).toHaveAccessibleDescription(/Blocked: Allowed travel is incompatible/);
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

  const sourceGroup = (page: Page, id = 101) =>
    harness(page).getByRole("region", { name: `Imported node ${id}`, exact: true });
  const target = (page: Page, id: number) =>
    sourceGroup(page).getByRole("radio", { name: new RegExp(`^Base node ${id}(?: \\(|$)`) });

  async function expectAlternativePreview(
    page: Page,
    selected: number | null,
    connected = selected,
  ) {
    await harness(page)
      .getByRole("button", { name: "Preview current choices", exact: true })
      .click();
    await expect(harness(page).getByTestId("preview-refs")).toHaveText(`${connected ?? 101}, 103`);
    const before = await readState(page);
    for (const id of [1, 2, 3]) {
      const change = before.preview?.changes?.find(
        (entry) => entry.entity.id === id && "lon" in entry.entity,
      );
      if (id === selected)
        expect(change).toMatchObject({
          changeType: "modify",
          entity: { tags: { name: "Imported entrance" } },
        });
      else expect(change).toBeUndefined();
    }
    expect(before.preview?.changes?.find((entry) => entry.entity.id === 20)).toMatchObject({
      changeType: "create",
      entity: { refs: [connected ?? 101, 103] },
    });
    await harness(page)
      .getByRole("button", { name: "Regenerate current preview", exact: true })
      .click();
    await expect.poll(async () => (await readState(page)).generations).toBe(before.generations + 1);
    expect((await readState(page)).preview).toEqual(before.preview);
    await harness(page).getByRole("button", { name: "Back to matching", exact: true }).click();
  }

  test("alternative targets stay together through paging, filtering, replacement, and leaving unmatched", async ({
    page,
  }) => {
    await harness(page)
      .getByRole("button", { name: "Load alternative target fixture", exact: true })
      .click();
    await expect(
      sourceGroup(page).getByRole("radio", { name: "Leave unmatched", exact: true }),
    ).not.toBeChecked();
    await expect(sourceGroup(page)).toContainText("No target selected");
    await sourceGroup(page).getByRole("radio", { name: "Leave unmatched", exact: true }).click();
    await expect(
      sourceGroup(page).getByRole("radio", { name: "Leave unmatched", exact: true }),
    ).toBeChecked();
    expect((await readState(page)).decisions).toEqual([
      { candidateId: "node:101->1", action: "reject" },
      { candidateId: "node:101->2", action: "reject" },
    ]);
    await harness(page)
      .getByRole("button", { name: "Load alternative target fixture", exact: true })
      .click();
    await expect(sourceGroup(page)).toContainText("No target selected");
    await expect(target(page, 1)).toBeVisible();
    await expect(target(page, 2)).toBeVisible();
    expect((await readState(page)).workerPage.groups?.[0]?.candidateIds).toEqual([
      "node:101->1",
      "node:101->2",
    ]);
    await expect(
      harness(page).getByRole("button", { name: "Page 1 of 3", exact: true }),
    ).toBeVisible();
    await harness(page).getByRole("button", { name: "Next", exact: true }).click();
    await sourceGroup(page, 102).getByRole("button", { name: "Skip match", exact: true }).click();
    await harness(page).getByRole("button", { name: "Previous", exact: true }).click();
    await target(page, 1).click();
    await expect(target(page, 1)).toBeChecked();
    await expect(target(page, 2)).not.toBeChecked();
    const unrelatedChoice = (await readState(page)).decisions.find(
      (decision) => decision.candidateId === "node:102->3",
    );
    expect(unrelatedChoice).toEqual({ candidateId: "node:102->3", action: "reject" });
    await expectAlternativePreview(page, 1);

    await harness(page)
      .getByRole("combobox", { name: "Match status", exact: true })
      .selectOption("accepted");
    await expect(target(page, 2)).toHaveAccessibleName("Base node 2 (outside current filters)");
    const filtered = (await readState(page)).workerPage;
    expect(filtered).toMatchObject({ totalCandidates: 1, totalSources: 1, totalPages: 1 });
    expect(
      filtered.candidates.map((candidate) => [candidate.targetId, candidate.matchesFilter]),
    ).toEqual([
      [1, true],
      [2, false],
    ]);
    await expect(
      harness(page).getByRole("button", { name: "Copy tags (0)", exact: true }),
    ).toBeDisabled();
    const secondRow = sourceGroup(page)
      .locator('[data-slot="item"]')
      .filter({ hasText: "Imported node 101 → Base node 2" });
    await secondRow.getByRole("checkbox", { name: "Copy tags", exact: true }).click();
    await expect(secondRow.getByRole("checkbox", { name: "Copy tags", exact: true })).toBeChecked();
    await expect(target(page, 2)).toBeChecked();
    await expect(target(page, 1)).not.toBeChecked();
    expect(
      (await readState(page)).decisions.find((decision) => decision.candidateId === "node:102->3"),
    ).toEqual(unrelatedChoice);
    expect((await readState(page)).requests.at(-1)).toEqual({
      kind: "source",
      source: { entityType: "node", sourceId: 101 },
      selected: {
        candidateId: "node:101->2",
        action: "accept",
        transferProperties: true,
        attachNetwork: false,
      },
    });
    await expectAlternativePreview(page, 2, null);
    await secondRow.getByRole("checkbox", { name: "Connect network", exact: true }).click();
    await expect(
      secondRow.getByRole("checkbox", { name: "Connect network", exact: true }),
    ).toBeChecked();
    await expectAlternativePreview(page, 2);
    await sourceGroup(page).getByRole("radio", { name: "Leave unmatched", exact: true }).click();
    await expect(harness(page)).toContainText("No candidates match these filters");
    await harness(page)
      .getByRole("combobox", { name: "Match status", exact: true })
      .selectOption("");
    await expect(
      sourceGroup(page).getByRole("radio", { name: "Leave unmatched", exact: true }),
    ).toBeChecked();
    expect((await readState(page)).decisions).toEqual(
      expect.arrayContaining([
        { candidateId: "node:101->1", action: "reject" },
        { candidateId: "node:101->2", action: "reject" },
        unrelatedChoice,
      ]),
    );
    await expectAlternativePreview(page, null);
  });

  test("a blocked alternative explains its disabled target while an eligible target remains selectable", async ({
    page,
  }) => {
    await harness(page)
      .getByRole("button", { name: "Load blocked target fixture", exact: true })
      .click();
    await expect(target(page, 2)).toBeDisabled();
    await expect(target(page, 2)).toHaveAccessibleDescription(
      /Unavailable: .*Allowed travel is incompatible/,
    );
    await expect(target(page, 1)).toBeEnabled();
    await target(page, 1).click();
    await expect(target(page, 1)).toBeChecked();
    await expect(target(page, 2)).not.toBeChecked();
    // Preserve the unrelated feature's original name when generating this focused choice.
    await harness(page).getByRole("button", { name: "Next", exact: true }).click();
    await sourceGroup(page, 102).getByRole("button", { name: "Skip match", exact: true }).click();
    await harness(page).getByRole("button", { name: "Previous", exact: true }).click();
    await expectAlternativePreview(page, 1);
  });

  test("a failed legacy review can return to the affected source, correct it, and regenerate without losing inputs", async ({
    page,
  }) => {
    await harness(page)
      .getByRole("button", { name: "Load conflicting saved review", exact: true })
      .click();
    await expect(sourceGroup(page).getByRole("alert")).toContainText(
      "More than one target is selected",
    );
    await harness(page)
      .getByRole("combobox", { name: "Match status", exact: true })
      .selectOption("rejected");
    await expect(sourceGroup(page, 102)).toBeVisible();
    const before = await readState(page);
    await harness(page)
      .getByRole("button", { name: "Preview current choices", exact: true })
      .click();
    const preview = harness(page).getByTestId("matching-preview");
    await expect(preview.getByRole("alert")).toContainText(
      "Multiple targets are scheduled for imported node 101",
    );
    await expect(preview).toContainText(
      "Your loaded inputs, options, and saved choices are retained",
    );
    await preview.getByRole("button", { name: "Regenerate current preview", exact: true }).click();
    expect((await readState(page)).generationAttempts).toBe(2);
    expect((await readState(page)).generations).toBe(0);
    expect((await readState(page)).decisions).toEqual(before.decisions);
    await preview.getByRole("button", { name: "Back to matching", exact: true }).click();
    await expect(harness(page)).toContainText("Showing imported node 101");
    await expect(sourceGroup(page)).toBeVisible();
    const returned = await readState(page);
    expect(returned.filter).toEqual({ entityType: "node", sourceId: 101 });
    expect(returned.inputs).toEqual(before.inputs);
    expect(returned.options).toEqual(before.options);
    expect(returned.decisions).toEqual(before.decisions);
    expect(returned.workerPage.validationConflict?.sourceId).toBe(101);

    const artifactDirectory = resolve(
      import.meta.dirname,
      "../../../output/playwright/pr-218-ticket08",
    );
    await mkdir(artifactDirectory, { recursive: true });
    for (const width of [320, 512]) {
      await page.setViewportSize({ width, height: 1000 });
      const panel = harness(page).getByTestId("conflation-review-panel");
      await expect
        .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth))
        .toBe(true);
      const path = resolve(artifactDirectory, `matching-correction-${width}.png`);
      await panel.screenshot({ path, animations: "disabled" });
      await test
        .info()
        .attach(`Correcting alternative targets at ${width}px`, { path, contentType: "image/png" });
    }

    await target(page, 2).click();
    await expect(target(page, 2)).toBeChecked();
    await expect(harness(page)).not.toContainText("Matching preview needs attention");
    expect(
      (await readState(page)).decisions.find((decision) => decision.candidateId === "node:102->3"),
    ).toEqual({ candidateId: "node:102->3", action: "reject" });
    await expectAlternativePreview(page, 2);
    expect((await readState(page)).inputs).toEqual(before.inputs);
    expect((await readState(page)).options).toEqual(before.options);
  });
});

async function generateAndApplyOutcome(page: Page) {
  const harness = page.getByTestId("merge-outcome-harness");
  await harness.getByRole("button", { name: "Generate completion preview" }).click();
  await expect(harness.getByLabel("Merge completion summary")).toHaveCount(0);
  await harness.getByRole("button", { name: "Apply completion preview" }).click();
  await expect(harness.getByLabel("Merge completion summary")).toHaveCount(0);
  return harness;
}

test("completion explains mixed matching results and downloads the retained report after apply", async ({
  page,
}) => {
  await page.goto("/e2e/guidance-harness.html?outcomes");
  const harness = await generateAndApplyOutcome(page);
  const applied = await page.evaluate(() => window.mergeOutcomeHarness.readState());
  expect(applied.reviewAvailable).toBe(false);
  expect(applied.baseName).toBe("Imported");
  await harness.getByRole("button", { name: "Refresh completion result" }).click();
  await harness.getByRole("button", { name: "Finish completion run" }).click();
  const summary = harness.getByLabel("Merge completion summary");
  await expect(summary).toContainText("Merge complete · unresolved matches remain");
  await expect(summary).toContainText("Imported features considered for matching: 5");
  await expect(summary.getByLabel("Applied matching actions").locator("dd")).toHaveText([
    "1",
    "1",
    "0",
    "3",
  ]);
  await expect(summary).toContainText("Intentionally skipped: 1");
  await summary.getByRole("button", { name: "Imported feature outcomes" }).click();
  await expect(summary.getByLabel("Imported feature outcome details")).toContainText(
    "Imported node 201",
  );
  await expect(summary.getByLabel("Imported feature outcome details")).toContainText(
    "Imported node 401",
  );
  await expect(summary.getByLabel("Imported feature outcome details")).toContainText(
    "Imported node 501",
  );
  await summary.getByRole("button", { name: "Selected tag outcomes" }).click();
  await summary.getByRole("combobox", { name: "Selected tag", exact: true }).selectOption("layer");
  await expect(summary).toContainText("This structural tag is protected");

  const retained = (await page.evaluate(() => window.mergeOutcomeHarness.readState())).completion;
  const downloadPromise = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Download merge report" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("osmix-merge-outcome.json");
  const path = await download.path();
  if (!path) throw Error("The merge report download was not written");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    format: "osmix-merge-outcome",
    version: 1,
    ...retained,
  });
  expect((await page.evaluate(() => window.mergeOutcomeHarness.readState())).completion).toEqual(
    retained,
  );
  const artifactDirectory = resolve(
    import.meta.dirname,
    "../../../output/playwright/pr-218-ticket09",
  );
  await mkdir(artifactDirectory, { recursive: true });
  for (const width of [320, 512]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => summary.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    const path = resolve(artifactDirectory, `merge-completion-${width}.png`);
    await summary.screenshot({ path, animations: "disabled" });
    await test.info().attach(`Merge completion at ${width}px`, { path, contentType: "image/png" });
  }
});

test("completion stays hidden during refresh failure and reports download failure inline", async ({
  page,
}) => {
  await page.goto("/e2e/guidance-harness.html?outcomes");
  const harness = await generateAndApplyOutcome(page);
  await harness.getByLabel("Fail next refresh").check();
  await harness.getByRole("button", { name: "Refresh completion result" }).click();
  await expect(harness.getByRole("alert")).toContainText("could not be refreshed");
  await expect(harness.getByRole("button", { name: "Finish completion run" })).toBeDisabled();
  await expect(harness.getByLabel("Merge completion summary")).toHaveCount(0);
  await harness.getByRole("button", { name: "Refresh completion result" }).click();
  await harness.getByRole("button", { name: "Finish completion run" }).click();
  const summary = harness.getByLabel("Merge completion summary");
  await expect(summary).toBeVisible();
  await harness.getByLabel("Fail report download").check();
  await summary.getByRole("button", { name: "Download merge report" }).click();
  await expect(summary.getByRole("alert")).toContainText(
    "The report could not be saved. Disk full",
  );
  await expect(summary).toContainText("Merge complete");
  await harness.getByRole("button", { name: "Reset completion scenario" }).click();
  await expect(harness.getByLabel("Merge completion summary")).toHaveCount(0);
});

for (const scenario of ["unresolved", "zero"] as const) {
  test(`completion handles ${scenario} matching without claiming actions`, async ({ page }) => {
    await page.goto("/e2e/guidance-harness.html?outcomes");
    const harness = page.getByTestId("merge-outcome-harness");
    await harness.getByLabel("Completion scenario").selectOption(scenario);
    await generateAndApplyOutcome(page);
    await harness.getByRole("button", { name: "Refresh completion result" }).click();
    await harness.getByRole("button", { name: "Finish completion run" }).click();
    const summary = harness.getByLabel("Merge completion summary");
    await expect(summary.getByLabel("Applied matching actions").locator("dd")).toHaveText([
      "0",
      "0",
      "0",
      scenario === "unresolved" ? "1" : "0",
    ]);
    if (scenario === "zero") {
      await expect(summary).toContainText("No imported features were considered for matching");
    } else {
      await expect(summary).toContainText("Merge complete · unresolved matches remain");
      await expect(summary.getByLabel("Unresolved imported features")).toContainText(
        "Choice still needed",
      );
    }
  });
}
