import { describe, expect, it } from "vitest";

import {
  DOCKED_MIN_WIDTH,
  isDockedWidth,
  observedBorderBoxWidth,
} from "../src/components/map-overlay.tsx";

describe("isDockedWidth", () => {
  it("docks until the overlay has been measured", () => {
    expect(isDockedWidth(null)).toBe(true);
  });

  it("docks at the threshold and above, not below it", () => {
    expect(isDockedWidth(DOCKED_MIN_WIDTH)).toBe(true);
    expect(isDockedWidth(DOCKED_MIN_WIDTH + 1)).toBe(true);
    expect(isDockedWidth(DOCKED_MIN_WIDTH - 1)).toBe(false);
    expect(isDockedWidth(0)).toBe(false);
  });
});

function entry(
  borderBoxSize: ResizeObserverEntry["borderBoxSize"] | undefined,
  rectWidth: number,
): ResizeObserverEntry {
  return {
    borderBoxSize,
    target: { getBoundingClientRect: () => ({ width: rectWidth }) },
  } as unknown as ResizeObserverEntry;
}

describe("observedBorderBoxWidth", () => {
  it("reads the border box, the same box the initial measurement uses", () => {
    expect(observedBorderBoxWidth(entry([{ inlineSize: 800, blockSize: 400 }], 799))).toBe(800);
  });

  it("falls back to the bounding rect when the entry has no border box", () => {
    expect(observedBorderBoxWidth(entry(undefined, 760))).toBe(760);
    expect(observedBorderBoxWidth(entry([], 760))).toBe(760);
  });
});
