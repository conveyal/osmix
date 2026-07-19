import { Osm } from "@osmix/core";
import { osmBlockToPbfBlobBytes, concatUint8 } from "@osmix/pbf";
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "@osmix/pbf";
import type { ProgressEvent } from "@osmix/shared/progress";
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
  it("preserves missing refs at the first, middle, and last positions across transfer", async () => {
    const missingRefsBlock: OsmPbfBlock = {
      stringtable: [new TextEncoder().encode("")],
      primitivegroup: [
        {
          nodes: [],
          dense: { id: [1, 1], lat: [0, 1], lon: [0, 1], keys_vals: [0, 0] },
          ways: [{ id: 300, keys: [], vals: [], refs: [99, -98, 97, -96, 95] }],
          relations: [],
        },
      ],
    };
    const data = concatUint8(
      await osmBlockToPbfBlobBytes(header),
      await osmBlockToPbfBlobBytes(missingRefsBlock),
    );
    const osm = await fromPbf(
      data,
      { spatialIndexes: { nodes: [], ways: false, relations: false } },
      () => {},
    );

    expect(osm.ways.getById(300)?.refs).toEqual([99, 1, 98, 2, 97]);
    const transferables = osm.transferables();
    expect(Array.from(new Uint32Array(transferables.ways.missingRefPositions))).toEqual([0, 2, 4]);
    expect(Array.from(new Float64Array(transferables.ways.missingRefIds))).toEqual([99, 98, 97]);

    const roundTripped = new Osm(transferables);
    expect(roundTripped.ways.getById(300)?.refs).toEqual([99, 1, 98, 2, 97]);
  });

  it("builds way and relation spatial indexes over dangling refs", async () => {
    const danglingRefsBlock: OsmPbfBlock = {
      stringtable: [new TextEncoder().encode("")],
      primitivegroup: [
        {
          nodes: [],
          dense: { id: [1, 1], lat: [0, 1], lon: [0, 1], keys_vals: [0, 0] },
          ways: [
            // Nodes 1 and 2 resolve; 99, 98, and 97 are dangling.
            { id: 300, keys: [], vals: [], refs: [99, -98, 97, -96, 95] },
            // Every ref is dangling: bbox must stay inverted and unmatchable.
            { id: 301, keys: [], vals: [], refs: [500, 1] },
          ],
          relations: [
            { id: 400, keys: [], vals: [], memids: [300], roles_sid: [0], types: [1] },
            // Way 301 has no resolvable geometry, so this relation does not either.
            { id: 401, keys: [], vals: [], memids: [301], roles_sid: [0], types: [1] },
          ],
        },
      ],
    };
    const data = concatUint8(
      await osmBlockToPbfBlobBytes(header),
      await osmBlockToPbfBlobBytes(danglingRefsBlock),
    );
    // The default Full profile builds every spatial index.
    const progressEvents: ProgressEvent[] = [];
    const osm = await fromPbf(data, {}, (event) => progressEvents.push(event));

    expect(osm.ways.hasSpatialIndex()).toBe(true);
    expect(osm.relations.hasSpatialIndex()).toBe(true);
    // Way 300's bbox comes from its two resolvable nodes; way 301 has none.
    expect(osm.ways.intersects([-1, -1, 1, 1])).toEqual([0]);
    expect(osm.relations.intersects([-1, -1, 1, 1])).toEqual([0]);
    expect(osm.ways.neighbors(0, 0, 10, 1)).toEqual([0]);
    expect(osm.relations.neighbors(0, 0, 10, 1)).toEqual([0]);
    expect(progressEvents).toContainEqual(
      expect.objectContaining({ detail: expect.objectContaining({ throttle: true }) }),
    );
    // Strict geometry access still fails for unresolvable refs.
    expect(() => osm.ways.getCoordinates(0)).toThrow(/not found for way geometry/);
    expect(osm.ways.getResolvedCoordinates(0)).toEqual([
      [0, 0],
      [1e-7, 1e-7],
    ]);
  });

  it("preserves refs and members when tag filtering drops their targets", async () => {
    const osm = await fromPbf(
      await createFilteredPbf(),
      {
        extractTagFilter: {
          nodes: [{ key: "keep" }],
          ways: [],
          relations: [],
        },
        spatialIndexes: { nodes: [], ways: false, relations: false },
      },
      () => {},
    );

    expect(osm.nodes.size).toBe(2);
    expect(osm.ways.size).toBe(4);
    expect(osm.ways.getFullEntity(0, 100).refs).toEqual([1, 2, 3]);
    expect(osm.ways.getFullEntity(1, 102).refs).toEqual([1, 3, 2]);
    expect(osm.ways.getFullEntity(2, 103).refs).toEqual([3, 1]);
    expect(osm.ways.getFullEntity(3, 101).refs).toEqual([3]);
    expect(osm.relations.size).toBe(2);
    expect(osm.relations.getFullEntity(0, 200).members).toEqual([
      { type: "node", ref: 3, role: "" },
      { type: "way", ref: 100, role: "" },
    ]);
    expect(osm.relations.getFullEntity(1, 201).members).toEqual([
      { type: "way", ref: 101, role: "" },
    ]);
  });
});
