import { concatUint8, osmBlockToPbfBlobBytes } from "@osmix/pbf";
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "@osmix/pbf";
import { describe, expect, it } from "vitest";

import { fromPbf } from "../src/pbf";

const header: OsmPbfHeaderBlock = {
  required_features: ["OsmSchema-V0.6"],
  optional_features: ["DenseNodes"],
};

const block: OsmPbfBlock = {
  stringtable: [
    new TextEncoder().encode(""),
    new TextEncoder().encode("highway"),
    new TextEncoder().encode("residential"),
  ],
  primitivegroup: [
    {
      nodes: [],
      dense: { id: [1, 1], lat: [0, 1], lon: [0, 1], keys_vals: [0, 0] },
      ways: [{ id: 10, keys: [1], vals: [2], refs: [1, 1] }],
      relations: [{ id: 20, keys: [], vals: [], memids: [1, 9], roles_sid: [0, 0], types: [0, 1] }],
    },
  ],
};

async function createPbf() {
  return concatUint8(await osmBlockToPbfBlobBytes(header), await osmBlockToPbfBlobBytes(block));
}

type SpatialIndexType = "node" | "way" | "relation";

const subsets: SpatialIndexType[][] = [
  [],
  ["node"],
  ["way"],
  ["relation"],
  ["node", "way"],
  ["node", "relation"],
  ["way", "relation"],
  ["node", "way", "relation"],
];

const subsetCases = subsets.map((subset) => [subset] as const);

describe("buildSpatialIndexes selection", () => {
  it("gives an explicit spatialIndexes selection highest precedence and deduplicates kinds", async () => {
    const osm = await fromPbf(
      await createPbf(),
      {
        spatialIndexes: { nodes: ["tagged", "tagged"], ways: false, relations: false },
        loadProfile: "full",
        buildSpatialIndexes: ["way"],
      },
      () => {},
    );

    expect(osm.nodes.hasSpatialIndex("tagged")).toBe(true);
    expect(osm.nodes.hasSpatialIndex("all")).toBe(false);
    expect(osm.ways.hasSpatialIndex()).toBe(false);
    expect(osm.relations.hasSpatialIndex()).toBe(false);
  });

  it("gives an explicit load profile precedence over the deprecated selector", async () => {
    const osm = await fromPbf(
      await createPbf(),
      { loadProfile: "view", buildSpatialIndexes: ["node"] },
      () => {},
    );

    expect(osm.nodes.hasSpatialIndex("tagged")).toBe(true);
    expect(osm.nodes.hasSpatialIndex("all")).toBe(false);
    expect(osm.ways.hasSpatialIndex()).toBe(true);
    expect(osm.relations.hasSpatialIndex()).toBe(true);
  });

  it.each(subsetCases)("builds exactly the requested indexes: %s", async (requested) => {
    const osm = await fromPbf(await createPbf(), { buildSpatialIndexes: [...requested] }, () => {});

    expect(osm.nodes.hasSpatialIndex()).toBe(requested.includes("node"));
    expect(osm.ways.hasSpatialIndex()).toBe(requested.includes("way"));
    expect(osm.relations.hasSpatialIndex()).toBe(requested.includes("relation"));

    if (requested.includes("node")) {
      expect(osm.nodes.findIndexesWithinRadius(0, 0, 0.000001)).toEqual([0]);
    }
    if (requested.includes("way")) {
      expect(osm.ways.intersects([0, 0, 1, 1])).toEqual([0]);
    }
    if (requested.includes("relation")) {
      expect(osm.relations.intersects([0, 0, 1, 1])).toEqual([0]);
    }
  });

  it("builds all spatial indexes when the option is omitted", async () => {
    const osm = await fromPbf(await createPbf(), {}, () => {});

    expect(osm.hasSpatialIndexes()).toBe(true);
    expect(osm.nodes.hasSpatialIndex()).toBe(true);
    expect(osm.ways.hasSpatialIndex()).toBe(true);
    expect(osm.relations.hasSpatialIndex()).toBe(true);
    expect(osm.info().loadDiagnostics?.phaseTimingsMs).toEqual({
      parse: expect.any(Number),
      entityIndexes: expect.any(Number),
      taggedNodeSpatialIndex: expect.any(Number),
      allNodeSpatialIndex: expect.any(Number),
      waySpatialIndex: expect.any(Number),
      relationSpatialIndex: expect.any(Number),
      spatialIndexes: expect.any(Number),
      total: expect.any(Number),
    });
    expect(osm.info().loadDiagnostics?.bytes.storageBytes).toBeGreaterThan(0);
  });
});
