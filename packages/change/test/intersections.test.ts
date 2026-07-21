import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import { OsmChangeset } from "../src/changeset.ts";
import { waysShouldConnect } from "../src/utils.ts";

function crossingWays() {
  const osm = new Osm({ id: "intersections" });
  const coordinates = [
    [1, 0, 0],
    [2, 2, 0],
    [3, 0.5, -1],
    [4, 0.5, 1],
    [5, 1.5, -1],
    [6, 1.5, 1],
  ] as const;
  for (const [id, lon, lat] of coordinates) osm.nodes.addNode({ id, lon, lat });
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "primary" } });
  osm.ways.addWay({ id: 11, refs: [3, 4], tags: { highway: "secondary" } });
  osm.ways.addWay({ id: 12, refs: [5, 6], tags: { highway: "secondary" } });
  osm.ways.addWay({ id: 13, refs: [1], tags: { highway: "service" } });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("intersection geometry integrity", () => {
  it("normalizes negative grade tags and compares the full vertical context", () => {
    expect(
      waysShouldConnect(
        { bridge: "no", highway: "primary", tunnel: "false" },
        { highway: "secondary" },
      ),
    ).toBe(true);
    expect(
      waysShouldConnect(
        { highway: "primary", layer: "-1", tunnel: "yes" },
        { highway: "secondary", layer: "-1", tunnel: "yes" },
      ),
    ).toBe(true);
    expect(
      waysShouldConnect({ covered: "yes", highway: "primary" }, { highway: "secondary" }),
    ).toBe(false);
    expect(
      waysShouldConnect({ highway: "primary", level: "1" }, { highway: "secondary", level: "2" }),
    ).toBe(false);
  });

  it("resolves pending intersection nodes when a way is spliced more than once", () => {
    const osm = crossingWays();
    const changeset = new OsmChangeset(osm);

    changeset.createIntersectionsForWays(osm.ways);

    expect(changeset.stats).toMatchObject({
      intersectionPointsFound: 2,
      intersectionNodesCreated: 2,
      nodeChanges: 2,
      wayChanges: 3,
    });
    const result = applyChangesetToOsm(changeset);
    const horizontal = result.ways.getById(10);
    expect(horizontal?.refs).toEqual([1, 7, 8, 2]);
    expect(horizontal?.refs.every((ref) => result.nodes.ids.has(ref))).toBe(true);
    expect(result.ways.getById(13)?.refs).toEqual([1]);
  });

  it("inserts multiple intersections in way order for reversed ways", () => {
    const osm = crossingWays();
    const reversed = osm.ways.getById(10)!;
    const changeset = new OsmChangeset(osm);
    changeset.modify("way", reversed.id, (way) => ({ ...way, refs: [2, 1] }));

    changeset.createIntersectionsForWays(osm.ways);

    const result = applyChangesetToOsm(changeset);
    expect(result.ways.getById(10)?.refs).toEqual([2, 8, 7, 1]);
  });

  it("rewrites via-node relation members when coincident way nodes are unified", () => {
    const osm = new Osm({ id: "restriction-intersection" });
    for (const node of [
      { id: 1, lon: -1, lat: 0 },
      { id: 2, lon: 0, lat: 0 },
      { id: 3, lon: 1, lat: 0 },
      { id: 4, lon: 0, lat: -1 },
      { id: 5, lon: 0, lat: 0 },
      { id: 6, lon: 0, lat: 1 },
    ]) {
      osm.nodes.addNode(node);
    }
    osm.ways.addWay({ id: 10, refs: [1, 2, 3], tags: { highway: "primary" } });
    osm.ways.addWay({ id: 20, refs: [4, 5, 6], tags: { highway: "primary" } });
    osm.relations.addRelation({
      id: 100,
      tags: { type: "restriction", restriction: "no_left_turn" },
      members: [
        { type: "way", ref: 10, role: "from" },
        { type: "node", ref: 5, role: "via" },
        { type: "way", ref: 20, role: "to" },
      ],
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const changeset = new OsmChangeset(osm);

    changeset.createIntersectionsForWays(osm.ways);

    const result = applyChangesetToOsm(changeset);
    expect(result.ways.getById(20)?.refs).toEqual([4, 2, 6]);
    expect(result.relations.getById(100)?.members[1]).toEqual({
      type: "node",
      ref: 2,
      role: "via",
    });
  });

  it("preserves a routing-critical base endpoint when a patch endpoint is reused", () => {
    const osm = new Osm({ id: "protected-endpoint" });
    for (const node of [
      { id: 1, lon: -1, lat: 0 },
      { id: 2, lon: 0, lat: 0, tags: { barrier: "gate", access: "private" } },
      { id: 5, lon: 0, lat: 0 },
      { id: 6, lon: 0, lat: 1 },
    ]) {
      osm.nodes.addNode(node);
    }
    osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "service" } });
    osm.ways.addWay({ id: 20, refs: [5, 6], tags: { highway: "service" } });
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const patch = new Osm({ id: "patch" });
    patch.nodes.addNode({ id: 5, lon: 0, lat: 0 });
    patch.nodes.addNode({ id: 6, lon: 0, lat: 1 });
    patch.ways.addWay({ id: 20, refs: [5, 6], tags: { highway: "service" } });
    patch.buildIndexes();
    const changeset = new OsmChangeset(osm);

    changeset.createIntersectionsForWays(patch.ways);

    const result = applyChangesetToOsm(changeset);
    expect(result.ways.getById(10)?.refs).toEqual([1, 2]);
    expect(result.ways.getById(20)?.refs).toEqual([2, 6]);
    expect(result.nodes.getById(2)?.tags).toEqual({
      access: "private",
      barrier: "gate",
      crossing: "yes",
    });
  });

  it("preserves a shared base node ID when the patch endpoint adds routing tags", () => {
    const osm = new Osm({ id: "shared-base-endpoint" });
    for (const node of [
      { id: 1, lon: -1, lat: 0 },
      { id: 2, lon: 0, lat: 0 },
      { id: 3, lon: 1, lat: 0 },
      { id: 5, lon: 0, lat: 0, tags: { barrier: "gate" } },
      { id: 6, lon: 0, lat: 1 },
    ]) {
      osm.nodes.addNode(node);
    }
    osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "service" } });
    osm.ways.addWay({ id: 11, refs: [2, 3], tags: { highway: "service" } });
    osm.ways.addWay({ id: 20, refs: [5, 6], tags: { highway: "service" } });
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const patch = new Osm({ id: "patch" });
    patch.nodes.addNode({ id: 5, lon: 0, lat: 0, tags: { barrier: "gate" } });
    patch.nodes.addNode({ id: 6, lon: 0, lat: 1 });
    patch.ways.addWay({ id: 20, refs: [5, 6], tags: { highway: "service" } });
    patch.buildIndexes();
    const changeset = new OsmChangeset(osm);

    changeset.createIntersectionsForWays(patch.ways);

    const result = applyChangesetToOsm(changeset);
    expect(result.ways.getById(10)?.refs).toEqual([1, 2]);
    expect(result.ways.getById(11)?.refs).toEqual([2, 3]);
    expect(result.ways.getById(20)?.refs).toEqual([2, 6]);
    expect(result.nodes.getById(2)?.tags).toEqual({ barrier: "gate", crossing: "yes" });
  });

  it("declines endpoint reuse when node tags conflict", () => {
    const osm = new Osm({ id: "conflicting-endpoint" });
    for (const node of [
      { id: 1, lon: -1, lat: 0 },
      { id: 2, lon: 0, lat: 0, tags: { barrier: "gate" } },
      { id: 5, lon: 0, lat: 0, tags: { barrier: "lift_gate" } },
      { id: 6, lon: 0, lat: 1 },
    ]) {
      osm.nodes.addNode(node);
    }
    osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "service" } });
    osm.ways.addWay({ id: 20, refs: [5, 6], tags: { highway: "service" } });
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const changeset = new OsmChangeset(osm);

    changeset.createIntersectionsForWays(osm.ways);

    expect(changeset.stats.intersectionPointsFound).toBe(0);
    const result = applyChangesetToOsm(changeset);
    expect(result.ways.getById(10)?.refs).toEqual([1, 2]);
    expect(result.ways.getById(20)?.refs).toEqual([5, 6]);
  });

  it("reuses one pending node when three ways cross at the same point", () => {
    const osm = new Osm({ id: "three-way-intersection" });
    for (const node of [
      { id: 1, lon: -1, lat: 0 },
      { id: 2, lon: 1, lat: 0 },
      { id: 3, lon: 0, lat: -1 },
      { id: 4, lon: 0, lat: 1 },
      { id: 5, lon: -1, lat: -1 },
      { id: 6, lon: 1, lat: 1 },
    ]) {
      osm.nodes.addNode(node);
    }
    osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "primary" } });
    osm.ways.addWay({ id: 20, refs: [3, 4], tags: { highway: "secondary" } });
    osm.ways.addWay({ id: 30, refs: [5, 6], tags: { highway: "residential" } });
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const changeset = new OsmChangeset(osm);

    changeset.createIntersectionsForWays(osm.ways);

    expect(changeset.stats.intersectionNodesCreated).toBe(1);
    const result = applyChangesetToOsm(changeset);
    const sharedRefs = [10, 20, 30].map(
      (wayId) => result.ways.getById(wayId)!.refs.find((ref) => ref > 6)!,
    );
    expect(new Set(sharedRefs)).toEqual(new Set([7]));
    for (const wayId of [10, 20, 30]) {
      const way = result.ways.getById(wayId)!;
      const coordinates = way.refs.map((ref) => {
        const node = result.nodes.getById(ref)!;
        return [node.lon, node.lat];
      });
      expect(
        coordinates.some(
          (coordinate, index) =>
            index > 0 &&
            coordinate[0] === coordinates[index - 1]![0] &&
            coordinate[1] === coordinates[index - 1]![1],
        ),
      ).toBe(false);
    }
  });

  it("skips incomplete current and candidate ways without inventing geometry", () => {
    const osm = crossingWays();
    const changeset = new OsmChangeset(osm);
    changeset.modify("way", 10, (way) => ({ ...way, refs: [1, 999] }));

    changeset.createIntersectionsForWays(osm.ways);

    expect(changeset.stats).toMatchObject({
      intersectionPointsFound: 0,
      intersectionNodesCreated: 0,
      nodeChanges: 0,
      wayChanges: 1,
    });
    expect(changeset.nodeChanges).toEqual({});
    expect(changeset.wayChanges[11]).toBeUndefined();
    expect(changeset.wayChanges[12]).toBeUndefined();
  });
});
