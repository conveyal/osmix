import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { animationPhase, formatRenderingModeStatus, viewerShouldAnimate } from "../src/viewer.ts";

const execFileAsync = promisify(execFile);

describe("viewer loading animation lifecycle", () => {
  it("animates while parsing, labels, or tiles are pending and stops otherwise", () => {
    expect(viewerShouldAnimate("loading", 0)).toBe(true);
    expect(viewerShouldAnimate("ready", 2)).toBe(true);
    expect(viewerShouldAnimate("ready", 0, true)).toBe(true);
    expect(viewerShouldAnimate("ready", 0)).toBe(false);
    expect(viewerShouldAnimate("error", 2)).toBe(false);
  });

  it("derives phases from the clock instead of successful frame events", () => {
    expect(animationPhase(0)).toBe(0);
    expect(animationPhase(99)).toBe(0);
    expect(animationPhase(100)).toBe(1);
    expect(animationPhase(950)).toBe(9);
  });

  it("keeps OpenTUI animation independent from tile and label scheduling", async () => {
    const smokeTest = fileURLToPath(new URL("./viewer-animation-smoke.ts", import.meta.url));
    const { stdout } = await execFileAsync("bun", [smokeTest]);
    const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "null") as {
      animationFrameCount: number;
      backpressureFrameEvents: number;
      backpressureLabelCalls: number;
      backpressureRenderCalls: number;
      backpressureStaticCompositions: number;
      completedTiles: number;
      distinctShimmerFrames: number;
      distinctSpinnerPhases: number;
      finalRenderCalls: number;
      inputHandled: boolean;
      labelCalls: number;
      maxAnimationGapMs: number;
      quitHandled: boolean;
      renderCallsBeforeAnimation: number;
      resizeHandled: boolean;
      resumedAtClockPhase: boolean;
      staticCompositionsAfterAnimation: number;
      staticCompositionsBeforeAnimation: number;
      zoomHandled: boolean;
    };
    expect(result).toMatchObject({
      backpressureFrameEvents: 0,
      inputHandled: true,
      labelCalls: 0,
      quitHandled: true,
      resizeHandled: true,
      resumedAtClockPhase: true,
      zoomHandled: true,
    });
    expect(result.animationFrameCount).toBeGreaterThanOrEqual(8);
    expect(result.distinctSpinnerPhases).toBeGreaterThanOrEqual(8);
    expect(result.distinctShimmerFrames).toBeGreaterThanOrEqual(8);
    expect(result.maxAnimationGapMs).toBeLessThanOrEqual(250);
    expect(result.renderCallsBeforeAnimation).toBeGreaterThan(0);
    expect(result.finalRenderCalls).toBe(result.renderCallsBeforeAnimation);
    expect(result.staticCompositionsAfterAnimation).toBe(result.staticCompositionsBeforeAnimation);
    expect(result.backpressureRenderCalls).toBeGreaterThan(0);
    expect(result.completedTiles).toBe(result.backpressureRenderCalls);
    expect(result.backpressureLabelCalls).toBeGreaterThan(0);
    expect(result.backpressureStaticCompositions).toBeGreaterThan(1);
  }, 15_000);
});

describe("viewer tile rendering status", () => {
  it("does not add a status suffix for worker rendering", () => {
    expect(formatRenderingModeStatus("workers")).toBe("");
  });
});
