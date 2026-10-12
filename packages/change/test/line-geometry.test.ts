import type { LonLat } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { tracedLengthThrough } from "../src/rules/line-geometry.ts";

/** Degrees per meter at the equator. */
const M = 1 / 111_320;
const east = (meters: number, north = 0): LonLat => [meters * M, north * M];

describe("tracedLengthThrough", () => {
  const base = [east(0), east(100)];

  it("measures a parallel copy along its whole length through the vertex", () => {
    const copy = [east(10, 0.8), east(30, 0.8), east(60, 0.8)];
    expect(tracedLengthThrough(copy, 1, base, 1)).toBeCloseTo(50, 0);
    // Counting stops after the segment that makes it enough.
    expect(tracedLengthThrough(copy, 1, base, 1, 10)).toBeCloseTo(30, 0);
  });

  it("is short for a line that crosses or diverges, and 0 outside the tolerance", () => {
    const crossing = [east(50, -20), east(50, 0), east(50, 20)];
    expect(tracedLengthThrough(crossing, 1, base, 1)).toBeLessThan(3);
    const diverging = [east(10, 0.5), east(16, 0.5), east(30, 10)];
    // 6 m back to the first vertex; the line leaves the tolerance within a metre ahead.
    expect(tracedLengthThrough(diverging, 1, base, 1)).toBeCloseTo(6, 0);
    expect(tracedLengthThrough([east(10, 2), east(20, 2)], 0, base, 1)).toBe(0);
  });

  it("stops where the other line ends", () => {
    const past = [east(90, 0.5), east(95, 0.5), east(120, 0.5)];
    expect(tracedLengthThrough(past, 1, base, 1)).toBeCloseTo(10, 0);
  });
});
