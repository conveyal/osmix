import { osmBlockToPbfBlobBytes, concatUint8 } from "@osmix/pbf";
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
    new TextEncoder().encode("keep"),
    new TextEncoder().encode("yes"),
    new TextEncoder().encode("drop"),
    new TextEncoder().encode("no"),
    new TextEncoder().encode("highway"),
    new TextEncoder().encode("residential"),
  ],
  primitivegroup: [
    {
      nodes: [],
      dense: {
        id: [1, 1, 1],
        lat: [0, 1, 9],
        lon: [0, 1, 9],
        keys_vals: [1, 2, 0, 1, 2, 0, 3, 4, 0],
      },
      ways: [
        { id: 100, keys: [5], vals: [6], refs: [1, 1, 1] },
        { id: 102, keys: [5], vals: [6], refs: [1, 2, -1] },
        { id: 103, keys: [5], vals: [6], refs: [3, -2] },
        { id: 101, keys: [5], vals: [6], refs: [3] },
      ],
      relations: [
        {
          id: 200,
          keys: [],
          vals: [],
          memids: [3, 97],
          roles_sid: [0, 0],
          types: [0, 1],
        },
        {
          id: 201,
          keys: [],
          vals: [],
          memids: [101],
          roles_sid: [0],
          types: [1],
        },
      ],
    },
  ],
};

async function createFilteredPbf() {
  return concatUint8(await osmBlockToPbfBlobBytes(header), await osmBlockToPbfBlobBytes(block));
}

describe("missing node references", () => {
  it("prunes filtered refs and dangling relation members", async () => {
    const osm = await fromPbf(
      await createFilteredPbf(),
      {
        extractTagFilter: {
          nodes: [{ key: "keep" }],
          ways: [],
          relations: [],
        },
      },
      () => {},
    );

    expect(osm.nodes.size).toBe(2);
    expect(osm.ways.size).toBe(3);
    expect(osm.ways.getFullEntity(0, 100).refs).toEqual([1, 2]);
    expect(osm.ways.getFullEntity(1, 102).refs).toEqual([1, 2]);
    expect(osm.ways.getFullEntity(2, 103).refs).toEqual([1]);
    expect(osm.ways.getCoordinates(2)).toEqual([[0, 0]]);
    expect(osm.relations.size).toBe(1);
    expect(osm.relations.getFullEntity(0, 200).members).toEqual([
      { type: "way", ref: 100, role: "" },
    ]);

    osm.buildSpatialIndexes();
    expect(osm.ways.intersects([9, 9, 11, 11])).toEqual([]);
  });
});
