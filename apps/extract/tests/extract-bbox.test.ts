import { describe, expect, it } from "vitest";

import { headerBboxToGeoBbox } from "../src/lib/extract-bbox";

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
