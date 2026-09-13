import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, type Locator, type Page, test } from "@playwright/test";

const readState = (page: Page) => page.evaluate(() => window.conflationEvidenceHarness.readState());
const review = (page: Page) => page.getByTestId("evidence-review");
const comparison = (page: Page) =>
  review(page).getByRole("region", { name: "Selected map comparison" });
const ARTIFACT_DIRECTORY = resolve(import.meta.dirname, "../../../output/playwright/ticket10");

async function compareFirst(page: Page) {
  const button = review(page)
    .getByRole("button", { name: /Compare imported/ })
    .first();
  await button.focus();
  await button.press("Enter");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(comparison(page)).toBeVisible();
  const controls = await button.getAttribute("aria-controls");
  expect(controls).toBeTruthy();
  expect(await page.evaluate((id) => Boolean(id && document.getElementById(id)), controls)).toBe(
    true,
  );
  return button;
}

async function expectContained(locator: Locator) {
  expect(await locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
}

async function settleMap(page: Page) {
  await expect
    .poll(() =>
      page.getByTestId("evidence-map").evaluate((element) => {
        const canvas = element.querySelector("canvas");
        return canvas?.clientWidth === element.clientWidth;
      }),
    )
    .toBe(true);
  await expect.poll(async () => (await readState(page)).mapMoving).toBe(false);
}

async function focusContrast(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw Error("Canvas context required for rendered color measurement");
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      const linear = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const ring = luminance(style.getPropertyValue("--tw-ring-color"));
    const contrast = (token: string) => {
      const surface = luminance(style.getPropertyValue(token));
      return (Math.max(ring, surface) + 0.05) / (Math.min(ring, surface) + 0.05);
    };
    return {
      boxShadow: style.boxShadow,
      offset: style.getPropertyValue("--tw-ring-offset-width"),
      background: contrast("--background"),
      border: contrast("--border"),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/guidance-harness.html?evidence");
  await expect(page.getByTestId("evidence-harness")).toBeVisible();
  await expect.poll(async () => (await readState(page)).mapLoaded).toBe(true);
});

test("matching settings expose names, help, keyboard choices, and field-specific errors", async ({
  page,
}) => {
  const settings = page.getByRole("region", { name: "Match imported data", exact: true });
  const enable = settings.getByRole("checkbox", { name: "Enable proximity matching" });
  await expect(enable).toHaveAccessibleDescription(/possible matches between imported features/);
  await enable.focus();
  await enable.press("Space");
  await expect(enable).toBeChecked();

  const copy = settings.getByRole("checkbox", { name: "Copy tags", exact: true });
  const connect = settings.getByRole("checkbox", { name: "Connect network", exact: true });
  const keys = settings.getByRole("textbox", { name: "OSM tag keys to copy" });
  const radius = settings.getByRole("spinbutton", { name: "Candidate search radius (meters)" });
  await expect(copy).toHaveAccessibleDescription(/Imported geometry stays intact/);
  await expect(connect).toHaveAccessibleDescription(/changes how the paths connect/);
  await expect(keys).toHaveAccessibleDescription(/separated by commas or spaces/);
  await expect(radius).toHaveAccessibleDescription(/Proximity alone does not establish a match/);
  await keys.fill("");
  await expect(keys).toHaveAttribute("aria-invalid", "true");
  await expect(keys).toHaveAccessibleDescription(/Enter at least one OSM tag key/);
  await keys.fill("name surface");
  await expect(keys).not.toHaveAttribute("aria-invalid", "true");

  await copy.focus();
  await copy.press("Space");
  await expect(copy).not.toBeChecked();
  await expect(copy).toHaveAccessibleDescription(/Select Copy tags, Connect network, or both/);
  await expect(connect).toHaveAttribute("aria-invalid", "true");
  await expect(keys).toBeDisabled();
  await connect.focus();
  await connect.press("Space");
  await expect(connect).toBeChecked();
  await expect(connect).not.toHaveAttribute("aria-invalid", "true");

  await radius.fill("0");
  await expect(radius).toHaveAttribute("aria-invalid", "true");
  await expect(radius).toHaveAccessibleDescription(/greater than zero/);
  await radius.fill("1");
  await expect(radius).not.toHaveAttribute("aria-invalid", "true");
  const help = settings.getByRole("button", { name: "About candidate search radius" });
  await help.focus();
  await help.press("Enter");
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await expect(help).toBeFocused();
});

test("keyboard focus is visible against the form and survives forced colors", async ({
  page,
}, testInfo) => {
  const settings = page.getByRole("region", { name: "Match imported data", exact: true });
  await settings.getByRole("checkbox", { name: "Enable proximity matching" }).check();
  const radius = settings.getByRole("spinbutton", { name: "Candidate search radius (meters)" });
  await radius.focus();
  await expect(radius).toBeFocused();
  expect(await radius.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await expect
    .poll(async () => (await focusContrast(radius)).boxShadow)
    .toContain("0px 0px 0px 4px");
  const measured = await focusContrast(radius);
  expect(measured.boxShadow).not.toBe("none");
  expect(measured.offset.trim()).toBe("2px");
  expect(measured.background).toBeGreaterThanOrEqual(3);
  expect(measured.border).toBeGreaterThanOrEqual(3);
  await testInfo.attach("Focus contrast", {
    body: JSON.stringify(measured, null, 2),
    contentType: "application/json",
  });
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
  await writeFile(
    resolve(ARTIFACT_DIRECTORY, "focus-contrast.json"),
    JSON.stringify(measured, null, 2),
  );
  await page.emulateMedia({ forcedColors: "active" });
  const outline = await radius.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.style).toBe("solid");
  const reviewCopy = review(page).getByRole("checkbox", { name: "Copy tags", exact: true });
  const evidenceToggle = review(page).getByRole("button", {
    name: "Match evidence and attributes",
  });
  await page.keyboard.press("Tab");
  for (const control of [reviewCopy, evidenceToggle]) {
    await control.focus();
    await expect(control).toBeFocused();
    const style = await control.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        width: parseFloat(computed.outlineWidth),
        style: computed.outlineStyle,
        classes: element.className,
        focusVisible: element.matches(":focus-visible"),
      };
    });
    await testInfo.attach(`Forced colors ${await control.getAttribute("data-slot")}`, {
      body: JSON.stringify(style, null, 2),
      contentType: "application/json",
    });
    expect(style.focusVisible).toBe(true);
    expect(style.width).toBeGreaterThanOrEqual(2);
    await expect(control).toHaveCSS("outline-style", "solid");
  }
  await page.getByRole("button", { name: "Alternative point targets" }).focus();
  await page.keyboard.press("Enter");
  const radio = review(page).getByRole("radio", { name: "Leave unmatched" });
  await radio.focus();
  expect(await radio.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await expect(radio).toHaveCSS("outline-style", "solid");
  await expect(radio).toHaveCSS("outline-width", "2px");
});

test("finite, unknown, missing, and unmatched distances remain distinct", async ({ page }) => {
  const evidence = review(page)
    .getByRole("button", { name: "Match evidence and attributes" })
    .first();
  await evidence.focus();
  await evidence.press("Enter");
  await expect(evidence).toHaveAttribute("aria-expanded", "false");
  await evidence.press("Enter");
  await expect(evidence).toHaveAttribute("aria-expanded", "true");
  await expect(review(page)).toContainText(/0\.\d{3} m/);

  for (const scenario of ["Unavailable distance", "Missing distance"]) {
    await page.getByRole("button", { name: scenario, exact: true }).click();
    await expect(review(page)).toContainText("Distance unavailable for this target");
    await expect(review(page)).not.toContainText("No eligible base target within search radius");
    await expect(review(page)).not.toContainText(/Infinity|NaN/);
    await compareFirst(page);
    await expect(comparison(page)).toContainText("Base OSM (node 1)");
  }

  await page.getByRole("button", { name: "No eligible target", exact: true }).click();
  await expect(review(page)).toContainText("No eligible base target within search radius");
  await expect(review(page)).not.toContainText(/Infinity|NaN/);
  await compareFirst(page);
  await expect(comparison(page)).toContainText("No base target was proposed");
  expect((await readState(page)).comparison.features).toHaveLength(1);
});

test("school and cafe classifications block both actions when only name is selected", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Nearby school and cafe" }).click();
  await review(page)
    .getByRole("combobox", { name: "Match reason" })
    .selectOption({ label: "Feature classifications conflict" });
  await expect(review(page)).toContainText("Imported features matching these filters: 1");
  const conflict = review(page).getByRole("region", { name: "Feature type conflict", exact: true });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("amenity");
  await expect(conflict.locator("dd")).toHaveText(["cafe", "school"]);
  await expect(conflict).toContainText("even when they are not selected for copying");
  const attributes = review(page).getByRole("region", { name: "Attribute differences" });
  await expect(attributes).toContainText("name");
  await expect(attributes).not.toContainText("amenity");
  for (const name of ["Copy tags", "Connect network"]) {
    const action = review(page).getByRole("checkbox", { name, exact: true });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAccessibleDescription(/Blocked:.*Feature classifications conflict/);
    await expect(
      review(page).getByRole("button", { name: `${name} (0)`, exact: true }),
    ).toBeDisabled();
  }
  expect((await readState(page)).decisions).toEqual([]);

  const directory = resolve(import.meta.dirname, "../../../output/playwright/ticket11");
  await mkdir(directory, { recursive: true });
  for (const width of [320, 512]) {
    await page.setViewportSize({ width, height: 900 });
    await settleMap(page);
    await expectContained(review(page));
    await expectContained(conflict);
    const path = resolve(directory, `feature-type-conflict-${width}.png`);
    await review(page).screenshot({ path });
    await testInfo.attach(`Feature type conflict at ${width}px`, {
      path,
      contentType: "image/png",
    });
  }
});

test("keyboard comparison keeps coordinates, markers, and selection consistent without changing actions", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Alternative point targets", exact: true }).click();
  const before = (await readState(page)).decisions;
  const buttons = review(page).getByRole("button", { name: /Compare imported/ });
  await compareFirst(page);
  await expect(comparison(page).locator("dd")).toHaveText([
    "46.6000000°",
    "-120.5000000°",
    "46.6000000°",
    "-120.4999950°",
  ]);
  expect(
    (await readState(page)).comparison.features.map((feature) => feature.properties?.["entityId"]),
  ).toEqual([1, 101]);
  await buttons.nth(1).focus();
  await buttons.nth(1).press("Enter");
  await expect(buttons.first()).toHaveAttribute("aria-pressed", "false");
  await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(comparison(page)).toContainText("Base OSM (node 2)");
  await expect(comparison(page).locator("dd")).toHaveText([
    "46.6000000°",
    "-120.4999900°",
    "46.6000000°",
    "-120.4999950°",
  ]);
  const state = await readState(page);
  expect(state.comparison.features.map((feature) => feature.properties?.["entityId"])).toEqual([
    2, 101,
  ]);
  expect(state.decisions).toEqual(before);
  const targetMarker = page.getByTestId("evidence-map").getByRole("img", { name: /Base/ });
  await expect(targetMarker).toHaveAccessibleName(/-120\.4999900/);

  await review(page).getByRole("combobox", { name: "Match status" }).selectOption("blocked");
  await expect(comparison(page)).toHaveCount(0);
  await expect.poll(async () => (await readState(page)).comparison.features).toEqual([]);
  await expect(
    page.getByTestId("evidence-map").locator('[data-slot="comparison-map-marker"]'),
  ).toHaveCount(0);
});

test("keyboard target selection keeps native radio navigation and action descriptions", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Alternative point targets", exact: true }).click();
  const choices = review(page).getByRole("group", { name: "Choose one base target" });
  const radios = choices.getByRole("radio");
  await expect(radios).toHaveCount(3);
  await radios.nth(1).focus();
  await radios.nth(1).press("Space");
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(2)).toBeChecked();
  await expect(radios.nth(2)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(2)).toBeChecked();
  const copy = review(page).getByRole("checkbox", { name: "Copy tags", exact: true }).nth(1);
  await expect(copy).toBeChecked();
  await expect(copy).toHaveAccessibleDescription(/preview|scheduled/i);
  await copy.focus();
  await page.keyboard.press("Space");
  await expect(copy).not.toBeChecked();
  await expect(copy).toBeFocused();
  await page.keyboard.press("Space");
  await expect(copy).toBeChecked();
  await expect(copy).toBeFocused();
  await choices.getByRole("radio", { name: "Leave unmatched" }).focus();
  await page.keyboard.press("Space");
  await expect(choices.getByRole("radio", { name: "Leave unmatched" })).toBeChecked();
  await expect(copy).not.toBeChecked();
});

test("pending keyboard choices retain focus, reject another mutation, and never reclaim moved focus", async ({
  page,
}) => {
  const copy = review(page).getByRole("checkbox", { name: "Copy tags", exact: true });
  await page.getByRole("button", { name: "Delay next matching choice" }).click();
  await copy.focus();
  await page.keyboard.press("Space");
  await expect(copy).toHaveAttribute("aria-disabled", "true");
  await expect(copy).toBeFocused();
  await page.keyboard.press("Space");
  expect((await readState(page)).decisionCalls).toBe(1);
  await page.evaluate(() => window.conflationEvidenceHarness.completeChoice());
  await expect(copy).not.toBeChecked();
  await expect(copy).toBeEnabled();
  await expect(copy).toBeFocused();
  await page.keyboard.press("Space");
  await expect(copy).toBeChecked();
  expect((await readState(page)).decisionCalls).toBe(2);

  await page.getByRole("button", { name: "Delay next matching choice" }).click();
  await copy.focus();
  await page.keyboard.press("Space");
  await expect(copy).toHaveAttribute("aria-disabled", "true");
  const otherControl = page.getByRole("button", { name: "Finite point pair" });
  await otherControl.focus();
  await page.evaluate(() => window.conflationEvidenceHarness.completeChoice());
  await expect(copy).not.toBeChecked();
  await expect(copy).toBeEnabled();
  await expect(otherControl).toBeFocused();

  await page.getByRole("button", { name: "Alternative point targets" }).click();
  await page.getByRole("button", { name: "Delay next matching choice" }).click();
  const radios = review(page)
    .getByRole("group", { name: "Choose one base target" })
    .getByRole("radio");
  await radios.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(radios.nth(1)).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("ArrowDown");
  expect((await readState(page)).decisionCalls).toBe(1);
  await page.evaluate(() => window.conflationEvidenceHarness.completeChoice());
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(1)).toBeEnabled();
});

test("coincident point shapes remain distinct and way evidence wraps at narrow widths", async ({
  page,
}, testInfo) => {
  const artifactDirectory = ARTIFACT_DIRECTORY;
  await mkdir(artifactDirectory, { recursive: true });
  await page.getByRole("button", { name: "Coincident point pair", exact: true }).click();
  await compareFirst(page);
  const legend = comparison(page).getByRole("group", { name: "Map comparison legend" });
  await expect(legend).toContainText("Base OSM: circle, solid line");
  await expect(legend).toContainText("Imported feature: diamond, dashed line");
  await expect(legend).toContainText("diamond sits inside the circle");
  const features = (await readState(page)).comparison.features;
  expect(features[0]?.geometry).toEqual(features[1]?.geometry);
  const map = page.getByTestId("evidence-map");
  await expect(
    map.locator('[data-slot="comparison-marker-symbol"][data-role="target"] circle'),
  ).toHaveCount(2);
  await expect(
    map.locator('[data-slot="comparison-marker-symbol"][data-role="source"] path'),
  ).toHaveCount(1);
  for (const width of [320, 512]) {
    await page.setViewportSize({ width, height: 1000 });
    await settleMap(page);
    await expectContained(comparison(page));
    await expectContained(review(page));
    const path = resolve(artifactDirectory, `coincident-comparison-${width}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(`Co-located map comparison at ${width}px`, {
      path,
      contentType: "image/png",
    });
  }

  await page.getByRole("button", { name: "Way pair", exact: true }).click();
  await compareFirst(page);
  await expect(
    review(page).getByRole("button", { name: "Match evidence and attributes" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(comparison(page)).toContainText("Start");
  await expect(comparison(page)).toContainText("End");
  await expect(comparison(page).locator("dd")).toHaveText([
    "46.6001000°",
    "-120.5001000°",
    "46.6001000°",
    "-120.4999000°",
    "46.6001000°",
    "-120.5000950°",
    "46.6001000°",
    "-120.4998950°",
  ]);
  await expect
    .poll(async () => {
      const state = await readState(page);
      const source = Object.values(state.sources).find((source) => source.type === "geojson");
      return source?.type === "geojson" ? source.data : null;
    })
    .toEqual((await readState(page)).comparison);
  const layers = (await readState(page)).layers;
  const baseLine = layers.find((layer) => layer.id.endsWith(":base-lines"));
  const importedLine = layers.find((layer) => layer.id.endsWith(":imported-lines"));
  expect(baseLine?.type === "line" ? baseLine.paint?.["line-dasharray"] : null).toBeUndefined();
  expect(importedLine?.type === "line" ? importedLine.paint?.["line-dasharray"] : null).toEqual([
    2, 2,
  ]);
  for (const width of [320, 512]) {
    await page.setViewportSize({ width, height: 1000 });
    await settleMap(page);
    await expectContained(review(page));
    await expectContained(comparison(page));
    const path = resolve(artifactDirectory, `way-evidence-${width}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(`Way evidence at ${width}px`, { path, contentType: "image/png" });
  }
});
