import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import { OsmChangeset } from "../src/changeset.ts";

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
    expect(horizontal?.refs).toHaveLength(4);
    expect(horizontal?.refs.every((ref) => result.nodes.ids.has(ref))).toBe(true);
    expect(result.ways.getById(13)?.refs).toEqual([1]);
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
