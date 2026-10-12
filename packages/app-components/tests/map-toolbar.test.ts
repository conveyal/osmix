import type { GeoBbox2D } from "osmix";
import { describe, expect, it } from "vitest";

import { unionBboxes } from "../src/components/map-toolbar.tsx";

describe("unionBboxes", () => {
  it("is null with no bboxes", () => {
    expect(unionBboxes([])).toBeNull();
    expect(unionBboxes([null, undefined])).toBeNull();
  });

  it("returns a copy of a single bbox", () => {
    const bbox: GeoBbox2D = [7.4, 43.7, 7.45, 43.75];
    const union = unionBboxes([bbox]);
    expect(union).toEqual([7.4, 43.7, 7.45, 43.75]);
    expect(union).not.toBe(bbox);
  });

  it("skips datasets without a bbox and takes the extremes of the rest", () => {
    expect(unionBboxes([[7.4, 43.7, 7.45, 43.75], null, [7.3, 43.72, 7.42, 43.8]])).toEqual([
      7.3, 43.7, 7.45, 43.8,
    ]);
  });
});
