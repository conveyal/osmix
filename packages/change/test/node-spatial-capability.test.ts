import { Osm, SpatialIndexNotBuiltError } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { OsmChangeset } from "../src/changeset.ts";

describe("node deduplication spatial capability", () => {
  it("requires an all-node index and deduplicates successfully once it is built", () => {
    const osm = new Osm({ id: "dedup-capability" });
    osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    osm.nodes.addNode({ id: 2, lon: 0, lat: 0 });
    osm.buildIndexes();
    osm.nodes.buildSpatialIndex("tagged");

    expect(() => new OsmChangeset(osm).deduplicateNodes(osm.nodes)).toThrowError(
      SpatialIndexNotBuiltError,
    );

    osm.nodes.buildSpatialIndex("all");
    expect(new OsmChangeset(osm).deduplicateNodes(osm.nodes)).toEqual(new Map([[1, 2]]));
  });
});
