import { describe, expect, it } from "vitest";

import {
  estimatePlanHeapBytes,
  PLAN_HEAP_BUDGET_BYTES,
  planTooLargeReason,
} from "../src/lib/plan-memory";

// Imports measured for T35 (apps/bench plan-memory and Chromium over CDP).
const washington = { nodes: 1_107_476, ways: 368_648, relations: 0 };
const seattle = { nodes: 1_529_956, ways: 546_928, relations: 0 };

describe("plan memory", () => {
  it("lets Washington's and Seattle's imports plan with matching", () => {
    for (const stats of [washington, seattle]) {
      expect(estimatePlanHeapBytes(stats, true)).toBeLessThan(PLAN_HEAP_BUDGET_BYTES);
      expect(planTooLargeReason(stats, true)).toBeNull();
    }
  });

  it("refuses a larger import with matching, and says it fits without", () => {
    const larger = { nodes: 2_200_000, ways: 800_000, relations: 0 };
    const reason = planTooLargeReason(larger, true);
    expect(reason).toMatch(
      /Planning 3,000,000 imported entities with matching needs about 4\.2 GB/,
    );
    expect(reason).toMatch(/the browser allows 3\.5 GB, so the tab would crash/);
    expect(reason).toMatch(/or plan it without matching\.$/);
    expect(planTooLargeReason(larger, false)).toBeNull();
  });

  it("does not suggest turning matching off when that would not fit either", () => {
    const huge = { nodes: 4_000_000, ways: 1_000_000, relations: 0 };
    expect(planTooLargeReason(huge, true)).toMatch(/smaller areas with Extract\.$/);
    expect(planTooLargeReason(huge, false)).toMatch(/^Planning 5,000,000 imported entities needs/);
  });
});
