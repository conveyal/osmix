import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it, vi } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import { OsmChangeset } from "../src/changeset.ts";

function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("exact node group validation scaling", () => {
  it("bounds tag scans linearly for a large compatible group", () => {
    const sourceCount = 512;
    const tags = { amenity: "cafe", name: "Compatible cafe" };
    const base = dataset("scaling-base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = dataset(
      "scaling-import",
      Array.from({ length: sourceCount }, (_, index) => ({
        id: index + 101,
        lon: 0,
        lat: 0,
        tags,
      })),
    );
    const changeset = new OsmChangeset(base);
    changeset.generateDirectChanges(patch);

    // Count work rather than wall time. Setup and result validation are excluded;
    // a generous per-source allowance catches repeated pairwise tag traversal.
    const entries = vi.spyOn(Object, "entries");
    let entriesCalls = 0;
    let replacements: Map<number, number>;
    try {
      replacements = changeset.deduplicateNodes(patch.nodes);
      entriesCalls = entries.mock.calls.length;
    } finally {
      entries.mockRestore();
    }

    expect(entriesCalls).toBeLessThanOrEqual(sourceCount * 12);
    expect(replacements.size).toBe(sourceCount);
    expect([...replacements.values()].every((id) => id === 1)).toBe(true);
    expect(changeset.stats.deduplicatedNodes).toBe(sourceCount);
    const result = applyChangesetToOsm(changeset);
    expect([...result.nodes]).toEqual([{ id: 1, lon: 0, lat: 0, tags }]);
    expect(patch.nodes.size).toBe(sourceCount);
    expect(base.nodes.getById(1)).toEqual({ id: 1, lon: 0, lat: 0 });
  });

  it("preserves an existing mixed-grade junction when every imported source is isolated", () => {
    const base = dataset(
      "junction-base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -0.001, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
      ],
      [
        { id: 10, refs: [2, 1], tags: { highway: "footway", bridge: "yes", layer: "1" } },
        { id: 20, refs: [1, 3], tags: { highway: "footway" } },
      ],
    );
    const patch = dataset("junction-import", [
      { id: 101, lon: 0, lat: 0, tags: { amenity: "cafe" } },
      { id: 102, lon: 0, lat: 0, tags: { name: "Junction cafe" } },
    ]);
    const changeset = new OsmChangeset(base);
    changeset.generateDirectChanges(patch);

    expect(changeset.deduplicateNodes(patch.nodes)).toEqual(
      new Map([
        [101, 1],
        [102, 1],
      ]),
    );
    const result = applyChangesetToOsm(changeset);
    expect(result.nodes.getById(1)).toEqual({
      id: 1,
      lon: 0,
      lat: 0,
      tags: { amenity: "cafe", name: "Junction cafe" },
    });
    expect([...result.nodes].map((node) => node.id)).toEqual([1, 2, 3]);
    expect([...result.ways]).toEqual([...base.ways]);
    expect(changeset.stats.deduplicatedNodes).toBe(2);
  });
});
