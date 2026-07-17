import { Ways } from "@osmix/core";
import { concatUint8, osmBlockToPbfBlobBytes } from "@osmix/pbf";
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "@osmix/pbf";
import { describe, expect, it, vi } from "vitest";

import { fromPbf, OsmPbfEntityOrderError } from "../src/pbf.ts";

const encoder = new TextEncoder();
const header: OsmPbfHeaderBlock = {
  required_features: ["OsmSchema-V0.6"],
  optional_features: ["DenseNodes"],
};

function block(
  dense: OsmPbfBlock["primitivegroup"][number]["dense"],
  ways: OsmPbfBlock["primitivegroup"][number]["ways"],
): OsmPbfBlock {
  return {
    stringtable: [encoder.encode("")],
    primitivegroup: [{ nodes: [], dense, ways, relations: [] }],
  };
}

async function pbf(...blocks: OsmPbfBlock[]) {
  return concatUint8(
    await osmBlockToPbfBlobBytes(header),
    ...(await Promise.all(blocks.map((value) => osmBlockToPbfBlobBytes(value)))),
  );
}

describe("direct PBF way references", () => {
  it("resolves refs directly to Uint32 node indexes without using pending Float64 refs", async () => {
    const pendingLengths: number[] = [];
    // oxlint-disable-next-line typescript/unbound-method -- invoked with the spied instance below
    const original = Ways.prototype.addWays;
    const spy = vi.spyOn(Ways.prototype, "addWays").mockImplementation(function (
      this: Ways,
      ...args: Parameters<Ways["addWays"]>
    ) {
      const result = original.apply(this, args);
      const pending = (this as unknown as { pendingRefIds: { length: number } | null })
        .pendingRefIds;
      pendingLengths.push(pending?.length ?? 0);
      return result;
    });

    try {
      const osm = await fromPbf(
        await pbf(
          block({ id: [10, 10], lat: [0, 1], lon: [0, 1], keys_vals: [0, 0] }, [
            { id: 100, keys: [], vals: [], refs: [10, 10] },
          ]),
        ),
        { spatialIndexes: { nodes: [], ways: false, relations: false } },
        () => {},
      );

      expect(pendingLengths).toEqual([0]);
      expect(osm.ways.transferables().refs.byteLength).toBe(2 * Uint32Array.BYTES_PER_ELEMENT);
      expect(osm.ways.getById(100)?.refs).toEqual([10, 20]);
    } finally {
      spy.mockRestore();
    }
  });

  it("fails clearly when a later block contains nodes after ways", async () => {
    const data = await pbf(
      block({ id: [10], lat: [0], lon: [0], keys_vals: [0] }, [
        { id: 100, keys: [], vals: [], refs: [10] },
      ]),
      block({ id: [20], lat: [1], lon: [1], keys_vals: [0] }, []),
    );

    await expect(
      fromPbf(data, { spatialIndexes: { nodes: [], ways: false, relations: false } }, () => {}),
    ).rejects.toBeInstanceOf(OsmPbfEntityOrderError);
  });
});
