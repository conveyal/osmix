import { describe, expect, it } from "vitest";

import {
  estimatePlanHeapBytes,
  PLAN_HEAP_BUDGET_BYTES,
  planTooLargeReason,
} from "../src/lib/plan-memory";

// Imports measured for T34 (apps/bench plan-memory and Chromium over CDP).
const washington = { nodes: 1_107_476, ways: 368_648, relations: 0 };
const seattle = { nodes: 1_529_956, ways: 546_928, relations: 0 };

describe("plan memory", () => {
  it("lets Washington's sidewalk import plan with matching", () => {
    expect(estimatePlanHeapBytes(washington, true)).toBeLessThan(PLAN_HEAP_BUDGET_BYTES);
    expect(planTooLargeReason(washington, true)).toBeNull();
  });

  it("refuses Seattle's import with matching, and says what would fit", () => {
    const reason = planTooLargeReason(seattle, true);
    expect(reason).toMatch(
      /Planning 2,076,884 imported entities with matching needs about 4\.4 GB/,
    );
    expect(reason).toMatch(/the browser allows 3\.5 GB, so the tab would crash/);
    expect(reason).toMatch(/or plan it without matching\.$/);
    expect(planTooLargeReason(seattle, false)).toBeNull();
  });

  it("does not suggest turning matching off when that would not fit either", () => {
    const huge = { nodes: 4_000_000, ways: 1_000_000, relations: 0 };
    expect(planTooLargeReason(huge, true)).toMatch(/smaller areas with Extract\.$/);
    expect(planTooLargeReason(huge, false)).toMatch(/^Planning 5,000,000 imported entities needs/);
  });
});
