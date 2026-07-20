import { Osm, SpatialIndexNotBuiltError } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { createExtract } from "../src/extract.ts";

describe("extract node spatial capability", () => {
  it("requires an all-node index and extracts successfully once it is built", () => {
    const osm = new Osm({ id: "extract-capability" });
    osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    osm.nodes.addNode({ id: 2, lon: 1, lat: 1 });
    osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "path" } });
    osm.buildIndexes();
    osm.nodes.buildSpatialIndex("tagged");

    expect(() => createExtract(osm, [-0.1, -0.1, 0.1, 0.1], "complete_ways")).toThrowError(
      SpatialIndexNotBuiltError,
    );

    osm.nodes.buildSpatialIndex("all");
    const extracted = createExtract(osm, [-0.1, -0.1, 0.1, 0.1], "complete_ways");
    expect(Array.from(extracted.nodes, ({ id }) => id)).toEqual([1, 2]);
    expect(extracted.ways.getById(10)?.refs).toEqual([1, 2]);
  });
});
