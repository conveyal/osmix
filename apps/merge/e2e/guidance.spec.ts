import { expect, test } from "@playwright/test";

interface HarnessState {
  decision: string;
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

for (const width of [320, 512]) {
  test(`guidance and diagrams remain contained at a ${width}px sidebar width`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const trigger = page.getByRole("button", { name: "How this step works" });
    await trigger.click();

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
  });
}
