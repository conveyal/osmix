import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset";
import { OsmChangeset } from "../src/changeset";
import { generateOscChanges } from "../src/osc";
import { removeDuplicateAdjacentRelationMembers } from "../src/utils";

function createOsm(nodes: OsmNode[], ways: OsmWay[], relations: OsmRelation[]) {
  const osm = new Osm({ id: "fixture" });
  for (const node of nodes) osm.nodes.addNode(node);
  osm.nodes.buildIndex();
  for (const way of ways) osm.ways.addWay(way);
  osm.ways.buildIndex();
  for (const relation of relations) osm.relations.addRelation(relation);
  osm.relations.buildIndex();
  osm.stringTable.buildIndex();
  osm.buildSpatialIndexes();
  return osm;
}

describe("relation-safe deduplication", () => {
  it("does not collapse merely nearby nodes or rewrite their relation members", () => {
    const nodes: OsmNode[] = [
      { id: 1, lat: 0, lon: 0 },
      { id: 2, lat: 0.000007, lon: 0 },
      { id: 3, lat: 0.000014, lon: 0 },
    ];
    const ways: OsmWay[] = [{ id: 10, refs: [1, 3], tags: { highway: "path" } }];
    const relation: OsmRelation = {
      id: 20,
      members: [
        { type: "node", ref: 1, role: "stop" },
        { type: "node", ref: 2, role: "stop" },
        { type: "node", ref: 3, role: "platform" },
      ],
    };
    const osm = createOsm(nodes, ways, [relation]);
    const changeset = new OsmChangeset(osm);

    const replacements = changeset.deduplicateNodes(osm.nodes);

    expect(replacements).toEqual(new Map());
    const result = applyChangesetToOsm(changeset);
    expect(result.nodes.ids.has(1)).toBe(true);
    expect(result.nodes.ids.has(2)).toBe(true);
    expect(result.ways.getById(10)?.refs).toEqual([1, 3]);
    expect(result.relations.getById(20)?.members).toEqual([
      { type: "node", ref: 1, role: "stop" },
      { type: "node", ref: 2, role: "stop" },
      { type: "node", ref: 3, role: "platform" },
    ]);
  });

  it("returns flattened way maps and preserves relation roles and order", () => {
    const nodes: OsmNode[] = [
      { id: 1, lat: 0, lon: 0 },
      { id: 2, lat: 0, lon: 1 },
    ];
    const ways: OsmWay[] = [
      { id: 10, refs: [1, 2], tags: { highway: "path" } },
      { id: 20, refs: [1, 2], tags: { highway: "path" } },
      { id: 30, refs: [1, 2], tags: { highway: "path" } },
    ];
    const relation: OsmRelation = {
      id: 40,
      members: [
        { type: "way", ref: 10, role: "outer" },
        { type: "way", ref: 20, role: "outer" },
        { type: "way", ref: 30, role: "inner" },
        { type: "node", ref: 1, role: "label" },
      ],
    };
    const osm = createOsm(nodes, ways, [relation]);
    const changeset = new OsmChangeset(osm);

    const replacements = changeset.deduplicateWays(osm.ways);

    expect(replacements).toEqual(
      new Map([
        [10, 30],
        [20, 30],
      ]),
    );
    expect(generateOscChanges(changeset)).toContain(
      '<relation id="40"><member type="way" ref="30" role="outer" /><member type="way" ref="30" role="inner" /><member type="node" ref="1" role="label" /></relation>',
    );
    const result = applyChangesetToOsm(changeset);
    expect(result.ways.ids.has(10)).toBe(false);
    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.relations.getById(40)?.members).toEqual([
      { type: "way", ref: 30, role: "outer" },
      { type: "way", ref: 30, role: "inner" },
      { type: "node", ref: 1, role: "label" },
    ]);
  });

  it("only removes exact adjacent relation-member duplicates", () => {
    const relation: OsmRelation = {
      id: 1,
      members: [
        { type: "way", ref: 5, role: "outer" },
        { type: "way", ref: 5, role: "inner" },
        { type: "node", ref: 5, role: "inner" },
        { type: "node", ref: 5, role: "inner" },
        { type: "way", ref: 5, role: "outer" },
      ],
    };

    expect(removeDuplicateAdjacentRelationMembers(relation).members).toEqual([
      { type: "way", ref: 5, role: "outer" },
      { type: "way", ref: 5, role: "inner" },
      { type: "node", ref: 5, role: "inner" },
      { type: "way", ref: 5, role: "outer" },
    ]);
  });
});
