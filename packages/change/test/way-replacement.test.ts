import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { discoverWayReplacements } from "../src/plan/replacement.ts";
import { osmDatasetView } from "../src/views.ts";

/** Degrees per meter at the equator. */
const M = 1 / 111_320;
const footway = { highway: "footway" };

function osm(id: string, nodes: OsmNode[], ways: OsmWay[], relations: OsmRelation[] = []) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  for (const relation of relations) result.relations.addRelation(relation);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}

const discover = (base: Osm, patch: Osm, tolerance = 2) =>
  discoverWayReplacements(osmDatasetView(base), osmDatasetView(patch), tolerance);

/** A base footway 111 m east along the equator, with an untagged middle node. */
function baseLine(extra: { nodes?: OsmNode[]; ways?: OsmWay[]; relations?: OsmRelation[] } = {}) {
  return osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.0005, lat: 0 },
      { id: 3, lon: 0.001, lat: 0 },
      ...(extra.nodes ?? []),
    ],
    [{ id: 10, refs: [1, 2, 3], tags: footway }, ...(extra.ways ?? [])],
    extra.relations ?? [],
  );
}

/** An imported footway 1 m north of the base line, with vertices every quarter. */
function importedLine(
  reversed = false,
  tags: Record<number, Record<string, string>> = {},
  relations: OsmRelation[] = [],
) {
  const nodes = [0, 0.00025, 0.0005, 0.00075, 0.001].map((lon, index) => ({
    id: 101 + index,
    lon,
    lat: M,
    ...(tags[101 + index] ? { tags: tags[101 + index] } : {}),
  }));
  const refs = nodes.map(({ id }) => id);
  return osm(
    "patch",
    nodes,
    [{ id: 20, refs: reversed ? refs.toReversed() : refs, tags: footway }],
    relations,
  );
}

describe("way replacement discovery (MP-R2)", () => {
  it("keeps the imported way in place of the base way, joined to the base way's ends", () => {
    const { groups, misses } = discover(baseLine(), importedLine());
    expect(misses).toEqual([]);
    expect(groups).toEqual([
      {
        id: "replace:w20>w10",
        importedWayIds: [20],
        baseWayIds: [10],
        status: "review",
        reasons: [],
        anchors: [
          { baseNodeId: 1, importedNodeId: 101 },
          { baseNodeId: 3, importedNodeId: 105 },
        ],
        reviewReasons: [],
        mergedTags: [],
        wayTags: [{ wayId: 20, tags: footway }],
        refs: [{ wayId: 20, refs: [1, 102, 103, 104, 3] }],
        releasedNodeIds: [2],
      },
    ]);
  });

  it("keeps the imported way's own direction, and base direction tags only when it agrees", () => {
    const base = osm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [1, 3], tags: { ...footway, name: "Main Street", incline: "up" } }],
    );
    const [reversed] = discover(base, importedLine(true)).groups;
    expect(reversed?.refs).toEqual([{ wayId: 20, refs: [3, 104, 103, 102, 1] }]);
    expect(reversed?.wayTags).toEqual([{ wayId: 20, tags: { ...footway, name: "Main Street" } }]);
    const [same] = discover(base, importedLine()).groups;
    expect(same?.wayTags).toEqual([
      { wayId: 20, tags: { ...footway, name: "Main Street", incline: "up" } },
    ]);
  });

  it("keeps a junction with another way, paired with the nearest imported vertex", () => {
    const base = baseLine({
      nodes: [{ id: 4, lon: 0.0005, lat: -0.001 }],
      ways: [{ id: 11, refs: [2, 4], tags: footway }],
    });
    const [group] = discover(base, importedLine()).groups;
    expect(group?.status).toBe("review");
    expect(group?.anchors).toContainEqual({ baseNodeId: 2, importedNodeId: 103 });
    expect(group?.refs).toEqual([{ wayId: 20, refs: [1, 102, 2, 104, 3] }]);
    expect(group?.releasedNodeIds).toEqual([]);
  });

  it("splices a junction with no imported vertex nearby into the imported line, unmoved", () => {
    const base = osm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.0004, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
        { id: 4, lon: 0.0004, lat: -0.001 },
      ],
      [
        { id: 10, refs: [1, 2, 3], tags: footway },
        { id: 11, refs: [2, 4], tags: footway },
      ],
    );
    const patch = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: M },
        { id: 102, lon: 0.001, lat: M },
      ],
      [{ id: 20, refs: [101, 102], tags: footway }],
    );
    const [group] = discover(base, patch).groups;
    expect(group).toMatchObject({ status: "review", reasons: [] });
    expect(group?.anchors).toContainEqual({ baseNodeId: 2, importedNodeId: null, spliced: true });
    expect(group?.refs).toEqual([{ wayId: 20, refs: [1, 2, 3] }]);
    // Beyond the tolerance there is nothing to splice into.
    expect(discover(base, patch, 0.5).groups).toEqual([]);
  });

  it("keeps one imported way in place of a chain of base ways", () => {
    const base = osm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.0005, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
      ],
      [
        { id: 10, refs: [1, 2], tags: footway },
        { id: 11, refs: [2, 3], tags: footway },
      ],
    );
    const [group] = discover(base, importedLine()).groups;
    expect(group).toMatchObject({
      id: "replace:w20>w10,w11",
      status: "review",
      refs: [{ wayId: 20, refs: [1, 102, 2, 104, 3] }],
    });
  });

  it("keeps a chain of imported ways separate in place of one base way", () => {
    const patch = osm(
      "patch",
      [0, 0.0005, 0.001].map((lon, index) => ({ id: 101 + index, lon, lat: M })),
      [
        { id: 20, refs: [101, 102], tags: footway },
        { id: 30, refs: [102, 103], tags: footway },
      ],
    );
    const [group] = discover(baseLine(), patch).groups;
    expect(group).toMatchObject({
      id: "replace:w20,w30>w10",
      status: "review",
      refs: [
        { wayId: 20, refs: [1, 102] },
        { wayId: 30, refs: [102, 3] },
      ],
      releasedNodeIds: [2],
    });
  });

  it("leaves partial overlaps and many-to-many overlaps unmatched", () => {
    const base = osm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.0006, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
      ],
      [
        { id: 10, refs: [1, 2], tags: footway },
        { id: 11, refs: [2, 3], tags: footway },
      ],
    );
    // Split at another point, each imported way lies inside one base way but covers only part.
    const staggered = osm(
      "patch",
      [0, 0.0004, 0.001].map((lon, index) => ({ id: 101 + index, lon, lat: M })),
      [
        { id: 20, refs: [101, 102], tags: footway },
        { id: 30, refs: [102, 103], tags: footway },
      ],
    );
    expect(discover(base, staggered)).toEqual({
      groups: [],
      misses: [
        { importedWayIds: [20], baseWayIds: [10], reason: "not-covered" },
        { importedWayIds: [30], baseWayIds: [11], reason: "not-covered" },
      ],
    });
    // A second imported way along the same base way links both base ways to both imports.
    const doubled = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: M },
        { id: 102, lon: 0.001, lat: M },
        { id: 201, lon: 0.0007, lat: -M },
        { id: 202, lon: 0.0009, lat: -M },
      ],
      [
        { id: 20, refs: [101, 102], tags: footway },
        { id: 30, refs: [201, 202], tags: footway },
      ],
    );
    expect(discover(base, doubled).misses).toEqual([
      { importedWayIds: [20, 30], baseWayIds: [10, 11], reason: "many-to-many" },
    ]);
  });

  it("merges a tagged imported vertex's tags onto the base node that takes its place", () => {
    const tagged = importedLine(false, { 101: { tactile_paving: "yes" } });
    const [group] = discover(baseLine(), tagged).groups;
    expect(group?.status).toBe("review");
    expect(group?.mergedTags).toEqual([{ nodeId: 1, tags: { tactile_paving: "yes" } }]);
    // Imported values win, including a new barrier; only a change of grade needs review.
    const base = osm(
      "base",
      [
        { id: 1, lon: 0, lat: 0, tags: { tactile_paving: "no" } },
        { id: 2, lon: 0.0005, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2, 3], tags: footway }],
    );
    expect(discover(base, tagged).groups[0]?.mergedTags).toEqual([
      { nodeId: 1, tags: { tactile_paving: "yes" } },
    ]);
    const kerb = importedLine(false, { 101: { barrier: "kerb", kerb: "lowered" } });
    expect(discover(baseLine(), kerb).groups[0]).toMatchObject({
      status: "review",
      mergedTags: [{ nodeId: 1, tags: { barrier: "kerb", kerb: "lowered" } }],
    });
  });

  it("keeps the imported way's tags, and leaves a change of grade to a person", () => {
    const sidewalk = osm(
      "patch",
      [0, 0.001].map((lon, index) => ({ id: 101 + index, lon, lat: M })),
      [{ id: 20, refs: [101, 102], tags: { ...footway, footway: "sidewalk", surface: "paved" } }],
    );
    expect(discover(baseLine(), sidewalk).groups[0]).toMatchObject({
      status: "review",
      reviewReasons: [],
      wayTags: [{ wayId: 20, tags: { highway: "footway", footway: "sidewalk", surface: "paved" } }],
    });
    const bridge = osm(
      "patch",
      [0, 0.001].map((lon, index) => ({ id: 101 + index, lon, lat: M })),
      [{ id: 20, refs: [101, 102], tags: { ...footway, bridge: "yes", layer: "1" } }],
    );
    expect(discover(baseLine(), bridge).groups[0]).toMatchObject({
      status: "review",
      reviewReasons: ["grade-change"],
    });
  });

  it("blocks groups that pair a junction they share with different imported vertices", () => {
    // Base way 10 ends at junction 3 on base way 12. Imported way 20 ends 0.5 m from 3 at
    // vertex 105, which imported way 40 also passes through, but 40 has vertex 106 nearer to 3.
    const base = osm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
        { id: 7, lon: 0.001, lat: 0.0005 },
        { id: 8, lon: 0.001, lat: -0.0005 },
      ],
      [
        { id: 10, refs: [1, 3], tags: footway },
        { id: 12, refs: [7, 3, 8], tags: footway },
      ],
    );
    const patch = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.5 * M },
        { id: 105, lon: 0.001, lat: 0.5 * M },
        { id: 106, lon: 0.001, lat: -0.2 * M },
        { id: 201, lon: 0.001, lat: 0.0005 },
        { id: 202, lon: 0.001, lat: -0.0005 },
      ],
      [
        { id: 20, refs: [101, 105], tags: footway },
        { id: 40, refs: [201, 105, 106, 202], tags: footway },
      ],
    );
    const { groups } = discover(base, patch, 1);
    expect(groups.map(({ id, status, reasons }) => ({ id, status, reasons }))).toEqual([
      { id: "replace:w20>w10", status: "blocked", reasons: ["replacement-anchor-shared"] },
      { id: "replace:w40>w12", status: "blocked", reasons: ["replacement-anchor-shared"] },
    ]);
  });

  it("blocks when the imported vertex an anchor replaces belongs to a relation", () => {
    const patch = importedLine(false, {}, [
      { id: 60, tags: { type: "site" }, members: [{ type: "node", ref: 101, role: "" }] },
    ]);
    expect(discover(baseLine(), patch).groups[0]?.reasons).toEqual(["replacement-relation-member"]);
  });

  it("blocks on a turn restriction or another way kind", () => {
    const restricted = baseLine({
      relations: [
        {
          id: 50,
          tags: { type: "restriction", restriction: "no_left_turn" },
          members: [{ type: "way", ref: 10, role: "from" }],
        },
      ],
    });
    expect(discover(restricted, importedLine()).groups[0]?.reasons).toContain(
      "replacement-restriction",
    );
    const road = osm(
      "patch",
      [0, 0.001].map((lon, index) => ({ id: 101 + index, lon, lat: M })),
      [{ id: 20, refs: [101, 102], tags: { highway: "residential" } }],
    );
    expect(discover(baseLine(), road).groups[0]?.reasons).toContain("routing-family-conflict");
  });
});
