import { concatUint8, osmBlockToPbfBlobBytes } from "@osmix/pbf";
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "@osmix/pbf";
import { describe, expect, it } from "vitest";

import { fromPbf } from "../src/pbf";

const header: OsmPbfHeaderBlock = {
  required_features: ["OsmSchema-V0.6"],
  optional_features: ["DenseNodes"],
};

const blockOne: OsmPbfBlock = {
  stringtable: [
    new TextEncoder().encode(""),
    new TextEncoder().encode("highway"),
    new TextEncoder().encode("residential"),
  ],
  primitivegroup: [
    {
      nodes: [],
      dense: { id: [1], lat: [0], lon: [0], keys_vals: [0] },
      ways: [{ id: 100, keys: [1], vals: [2], refs: [1] }],
      relations: [],
    },
  ],
};

const blockTwo: OsmPbfBlock = {
  stringtable: [
    new TextEncoder().encode(""),
    new TextEncoder().encode("building"),
    new TextEncoder().encode("yes"),
  ],
  primitivegroup: [
    {
      nodes: [],
      ways: [
        { id: 200, keys: [1], vals: [2], refs: [1] },
        { id: 300, keys: [], vals: [], refs: [1] },
      ],
      relations: [],
    },
  ],
};

async function createTwoBlockPbf() {
  return concatUint8(
    await osmBlockToPbfBlobBytes(header),
    await osmBlockToPbfBlobBytes(blockOne),
    await osmBlockToPbfBlobBytes(blockTwo),
  );
}

describe("block-local way tags", () => {
  it("filters using translated tags and stores the same canonical tags", async () => {
    const osm = await fromPbf(
      await createTwoBlockPbf(),
      {
        extractTagFilter: {
          nodes: [],
          ways: [{ key: "highway" }],
          relations: [],
        },
      },
      () => {},
    );

    expect(osm.ways.size).toBe(1);
    expect(osm.ways.getById(100)?.tags).toEqual({ highway: "residential" });
    expect(osm.ways.getById(200)).toBeNull();
    expect(osm.ways.getById(300)).toBeNull();
  });
});
