import { describe, expect, it } from "vitest";

import { bboxesOverlap, DEFAULT_EXTRACT_BBOX, headerBboxToGeoBbox } from "../src/lib/extract-bbox";

describe("headerBboxToGeoBbox", () => {
  it("orders a PBF header bbox as [west, south, east, north]", () => {
    // fixtures/monaco.pbf header bbox
    const bbox = { left: 7.4053929, right: 7.4447259, top: 43.7543687, bottom: 43.7232244 };
    expect(headerBboxToGeoBbox(bbox)).toEqual([7.4053929, 43.7232244, 7.4447259, 43.7543687]);
  });

  it("returns null when the header has no bbox", () => {
    expect(headerBboxToGeoBbox(undefined)).toBeNull();
  });

  it("returns null for an inverted or out-of-range bbox", () => {
    expect(headerBboxToGeoBbox({ left: 10, right: 5, top: 1, bottom: 0 })).toBeNull();
    expect(headerBboxToGeoBbox({ left: 0, right: 200, top: 1, bottom: 0 })).toBeNull();
  });
});

describe("bboxesOverlap", () => {
  // ~/Downloads/portugal-260923.osm.pbf header bbox
  const portugal = [-33.616492, 29.251448, -6.179513, 42.1639] as const;

  it("detects partial overlap and containment", () => {
    expect(bboxesOverlap([-10, 36, 5, 43], [...portugal])).toBe(true);
    expect(bboxesOverlap([-9.25, 38.68, -9.08, 38.8], [...portugal])).toBe(true);
    expect(bboxesOverlap([...portugal], [-9.25, 38.68, -9.08, 38.8])).toBe(true);
  });

  it("rejects disjoint bboxes, such as the default bbox against Portugal", () => {
    expect(bboxesOverlap(DEFAULT_EXTRACT_BBOX, [...portugal])).toBe(false);
    expect(bboxesOverlap([0, 0, 1, 1], [0, 2, 1, 3])).toBe(false);
  });

  it("treats touching edges as overlapping", () => {
    expect(bboxesOverlap([0, 0, 1, 1], [1, 0, 2, 1])).toBe(true);
  });
});
