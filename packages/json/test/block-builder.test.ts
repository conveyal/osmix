import { describe, expect, it } from "vitest";

import { OsmPbfBlockBuilder } from "../src/osm-pbf-block-builder";
import { OsmPbfBlockParser } from "../src/osm-pbf-block-parser";

const decoder = new TextDecoder();

function decodeStringtable(builder: OsmPbfBlockBuilder) {
  return builder.stringtable.map((entry) => decoder.decode(entry));
}

describe("OsmPbfBlockBuilder", () => {
  it("delta encodes dense nodes and collects tags", () => {
    const builder = new OsmPbfBlockBuilder({
      includeInfo: true,
      date_granularity: 1_000,
      granularity: 1,
    });

    builder.addDenseNode({
      id: 5,
      lat: 10,
      lon: 20,
      tags: { name: "first" },
      info: {
        version: 1,
        timestamp: 2_000,
        changeset: 10,
        uid: 12,
        user_sid: 7,
        visible: true,
      },
    });

    builder.addDenseNode({
      id: 6,
      lat: 11,
      lon: 21,
      tags: { name: "second" },
      info: {
        version: 2,
        timestamp: 5_000,
        changeset: 15,
        uid: 20,
        user_sid: 8,
        visible: false,
      },
    });

    expect(builder.primitivegroup?.[0]?.dense).toBeDefined();
    if (!builder.primitivegroup[0]) throw new Error("builder.primitivegroup[0] is undefined");
    const dense = builder.primitivegroup[0].dense;
    expect(dense).toBeDefined();
    expect(dense?.id).toEqual([5, 1]);
    expect(dense?.lat).toEqual([10, 1]);
    expect(dense?.lon).toEqual([20, 1]);
    expect(dense?.keys_vals).toEqual([1, 2, 0, 1, 3, 0]);
    expect(dense?.denseinfo?.version).toEqual([1, 2]);
    expect(dense?.denseinfo?.timestamp).toEqual([2, 3]);
    expect(dense?.denseinfo?.changeset).toEqual([10, 5]);
    expect(dense?.denseinfo?.uid).toEqual([12, 8]);
    expect(dense?.denseinfo?.user_sid).toEqual([7, 1]);
    expect(dense?.denseinfo?.visible).toEqual([true, false]);
    expect(decodeStringtable(builder)).toEqual(["", "name", "first", "second"]);
  });

  it("encodes ways and relations with delta members", () => {
    const builder = new OsmPbfBlockBuilder({ includeInfo: true });

    builder.addWay({
      id: 7,
      refs: [10, 11, 15],
      tags: { highway: "service" },
      info: {
        version: 1,
        timestamp: 1_000,
        changeset: 3,
        uid: 4,
        user: "way",
      },
    });

    builder.addRelation({
      id: 9,
      members: [
        {
          type: "node",
          ref: 8,
          role: "outer",
        },
        {
          type: "way",
          ref: 12,
          role: "inner",
        },
      ],
      tags: { type: "multipolygon" },
      info: {
        version: 3,
        timestamp: 2_000,
        changeset: 4,
        uid: 5,
        user: "relation",
      },
    });

    const group = builder.primitivegroup[0];
    expect(group?.ways[0]).toBeDefined();
    if (!group) throw new Error("group is undefined");
    expect(group.ways).toHaveLength(1);
    if (!group.ways[0]) throw new Error("group.ways[0] is undefined");
    expect(group.ways[0].refs).toEqual([10, 1, 4]);
    expect(group.ways[0].keys).toHaveLength(1);
    expect(group.ways[0].vals).toHaveLength(1);
    expect(group.relations).toHaveLength(1);
    expect(group?.relations[0]).toBeDefined();
    if (!group.relations[0]) throw new Error("group.relations[0] is undefined");
    expect(group.relations[0].memids).toEqual([8, 4]);
    expect(group.relations[0].roles_sid).toHaveLength(2);
    expect(group.relations[0].types).toEqual([0, 1]);
  });

  it.each([1_000, 250])(
    "applies date granularity to ordinary and dense info timestamps (%d ms)",
    (dateGranularity) => {
      const builder = new OsmPbfBlockBuilder({
        includeInfo: true,
        date_granularity: dateGranularity,
        granularity: 1,
      });
      const timestamp = 1_234;
      const divisibleTimestamp = dateGranularity * 2;

      builder.addNode({
        id: 1,
        lat: 10,
        lon: 20,
        info: {
          version: 1,
          timestamp,
          changeset: 2,
          uid: 3,
          user: "node",
          visible: true,
        },
      });
      builder.addDenseNode({
        id: 2,
        lat: 11,
        lon: 21,
        info: {
          version: 2,
          timestamp,
          changeset: 4,
          uid: 5,
          user_sid: 0,
          visible: false,
        },
      });
      builder.addWay({
        id: 3,
        refs: [1, 2],
        info: {
          version: 3,
          timestamp: divisibleTimestamp,
          changeset: 6,
          uid: 7,
          user: "way",
          visible: true,
        },
      });
      builder.addRelation({
        id: 4,
        members: [{ type: "node", ref: 1, role: "label" }],
        info: {
          version: 4,
          timestamp,
          changeset: 8,
          uid: 9,
          user: "relation",
          visible: false,
        },
      });
      builder.addNode({ id: 5, lat: 12, lon: 22 });

      const group = builder.primitivegroup[0];
      if (!group) throw new Error("group is undefined");
      if (!group.nodes[0] || !group.dense || !group.ways[0] || !group.relations[0]) {
        throw Error("expected all entity formats");
      }
      const expectedUnits = Math.floor(timestamp / dateGranularity);
      const divisibleUnits = divisibleTimestamp / dateGranularity;
      expect(group.nodes[0].info?.timestamp).toBe(expectedUnits);
      expect(group.dense.denseinfo?.timestamp[0]).toBe(expectedUnits);
      expect(group.ways[0].info?.timestamp).toBe(divisibleUnits);
      expect(group.relations[0].info?.timestamp).toBe(expectedUnits);
      expect(group.nodes[0].info?.timestamp).toSatisfy(Number.isInteger);
      expect(group.ways[0].info?.timestamp).toSatisfy(Number.isInteger);
      expect(group.relations[0].info?.timestamp).toSatisfy(Number.isInteger);

      const parser = new OsmPbfBlockParser(builder, { includeInfo: true });
      const node = parser.parseNode(group.nodes[0], { includeInfo: true });
      const [denseNode] = parser.parseDenseNodes(group.dense, { includeInfo: true });
      const way = parser.parseWay(group.ways[0], { includeInfo: true });
      const relation = parser.parseRelation(group.relations[0], { includeInfo: true });
      const expectedTimestamp = expectedUnits * dateGranularity;

      expect(node.info?.timestamp).toBe(expectedTimestamp);
      expect(denseNode?.info?.timestamp).toBe(expectedTimestamp);
      expect(way.info?.timestamp).toBe(divisibleTimestamp);
      expect(relation.info?.timestamp).toBe(expectedTimestamp);
      expect(Math.abs(timestamp - expectedTimestamp)).toBeLessThan(dateGranularity);
      expect(node.info).toMatchObject({ version: 1, changeset: 2, uid: 3, user: "node" });
      expect(denseNode?.info).toMatchObject({
        version: 2,
        changeset: 4,
        uid: 5,
        user_sid: 0,
        visible: false,
      });
      expect(way.info).toMatchObject({ version: 3, changeset: 6, uid: 7, user: "way" });
      expect(relation.info).toMatchObject({
        version: 4,
        changeset: 8,
        uid: 9,
        user: "relation",
      });
      const missingInfoNode = builder.primitivegroup[0]?.nodes[1];
      if (!missingInfoNode) throw new Error("missing-info node is undefined");
      expect(missingInfoNode.info?.timestamp).toBe(0);
      expect(
        parser.parseNode(missingInfoNode, { includeInfo: true }).info?.timestamp,
      ).toBeUndefined();
    },
  );

  it("reports block capacity", () => {
    const builder = new OsmPbfBlockBuilder({ maxEntitiesPerBlock: 2 });
    expect(builder.isEmpty()).toBe(true);
    builder.addDenseNode({
      id: 1,
      lat: 0,
      lon: 0,
    });
    expect(builder.isFull()).toBe(false);
    builder.addDenseNode({
      id: 2,
      lat: 0,
      lon: 0,
    });
    expect(builder.isFull()).toBe(true);
  });
});
