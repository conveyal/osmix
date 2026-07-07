import type { PbfFixture } from "@osmix/test-utils/fixtures";

import { osmBlockToPbfBlobBytes } from "../src/blocks-to-pbf";
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "../src/proto/osmformat";
import { concatUint8, createOsmEntityCounter } from "../src/utils";

const encoder = new TextEncoder();

export function createSampleHeader(): OsmPbfHeaderBlock {
  return {
    bbox: { left: 0, right: 1, top: 1, bottom: 0 },
    required_features: ["OsmSchema-V0.6"],
    optional_features: ["DenseNodes"],
    writingprogram: "osmix-tests",
  };
}

export function createSamplePrimitiveBlock(): OsmPbfBlock {
  return {
    stringtable: [encoder.encode(""), encoder.encode("name"), encoder.encode("value")],
    primitivegroup: [
      {
        nodes: [],
        dense: {
          id: [1, 2],
          lat: [1_000, 500],
          lon: [1_500, 600],
          keys_vals: [1, 2, 0],
        },
        ways: [
          {
            id: 10,
            keys: [1],
            vals: [2],
            refs: [1, 1, 0],
          },
        ],
        relations: [],
      },
    ],
  } as const;
}

export async function createSamplePbfFileBytes() {
  const header = createSampleHeader();
  const primitiveBlock = createSamplePrimitiveBlock();
  const headerBytes = await osmBlockToPbfBlobBytes(header);
  const primitiveBytes = await osmBlockToPbfBlobBytes(primitiveBlock);
  return {
    header,
    primitiveBlock,
    fileBytes: concatUint8(headerBytes, primitiveBytes),
  };
}

export function isHeaderBlock(value: unknown): value is OsmPbfHeaderBlock {
  return typeof value === "object" && value != null && "required_features" in value;
}

export function isPrimitiveBlock(value: unknown): value is OsmPbfBlock {
  return typeof value === "object" && value != null && "primitivegroup" in value;
}

function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) throw Error(message ?? "Assertion failed");
}

function bboxEqual(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): boolean {
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
}

export async function testOsmPbfReader(
  osm: {
    header: OsmPbfHeaderBlock;
    blocks: AsyncGenerator<OsmPbfBlock>;
  },
  pbf: PbfFixture,
) {
  assert(
    osm.header.bbox != null && bboxEqual(osm.header.bbox, pbf.bbox),
    `Header bbox ${JSON.stringify(osm.header.bbox)} != ${JSON.stringify(pbf.bbox)}`,
  );

  const { onGroup, count } = createOsmEntityCounter();
  for await (const block of osm.blocks) for (const group of block.primitivegroup) onGroup(group);

  assert(count.nodes === pbf.nodes, `Expected nodes: ${pbf.nodes}, got: ${count.nodes}`);
  assert(count.ways === pbf.ways, `Expected ways: ${pbf.ways}, got: ${count.ways}`);
  assert(
    count.relations === pbf.relations,
    `Expected relations: ${pbf.relations}, got: ${count.relations}`,
  );
  assert(count.node0 === pbf.node0.id, `Expected node0: ${pbf.node0.id}, got: ${count.node0}`);
  assert(count.way0 === pbf.way0, `Expected way0: ${pbf.way0}, got: ${count.way0}`);
  assert(
    count.relation0 === pbf.relation0,
    `Expected relation0: ${pbf.relation0}, got: ${count.relation0}`,
  );

  return count;
}
