import { describe, expect, it } from "vitest";

import { percentile, summarize } from "../src/harness/stats";

describe("timing stats", () => {
  it("interpolates percentiles between samples", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.95)).toBeCloseTo(38.5);
    expect(percentile([7], 0.95)).toBe(7);
  });

  it("summarizes unsorted samples", () => {
    const stats = summarize([5, 1, 3]);
    expect(stats.median).toBe(3);
    expect(stats.p95).toBeCloseTo(4.8);
    expect(stats.min).toBe(1);
    expect(stats.runs).toBe(3);
  });

  it("rejects an empty sample set", () => {
    expect(() => summarize([])).toThrow("at least one sample");
  });
});
