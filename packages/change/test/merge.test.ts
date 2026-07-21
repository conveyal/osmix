import type { Osm } from "@osmix/core";
import { createMockBaseOsm, createMockPatchOsm } from "@osmix/core/mocks";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset";
import { OsmChangeset } from "../src/changeset";
import { generateChangeset } from "../src/generate-changeset";

const sizes = (osm: Osm) => ({
  nodes: osm.nodes.size,
  ways: osm.ways.size,
  relations: osm.relations.size,
});

describe("merge osm", () => {
  it("should generate and apply osm changes", () => {
    const base = createMockBaseOsm();
    const patch = createMockPatchOsm();
    base.buildSpatialIndexes();

    expect(sizes(base)).toEqual({
      nodes: 2,
      ways: 1,
      relations: 0,
    });
    expect(sizes(patch)).toEqual({
      nodes: 8,
      ways: 4,
      relations: 0,
    });

    let changeset = new OsmChangeset(base);
    changeset.generateDirectChanges(patch);
    expect(changeset.stats).toEqual({
      osmId: base.id,
      totalChanges: 10,
      nodeChanges: 6,
      wayChanges: 4,
      relationChanges: 0,
      deduplicatedNodes: 0,
      deduplicatedNodesReplaced: 0,
      deduplicatedWays: 0,
      intersectionPointsFound: 0,
      intersectionNodesCreated: 0,
    });

    const directResult = applyChangesetToOsm(changeset);
    expect(sizes(directResult)).toEqual({
      nodes: patch.nodes.size - changeset.stats.deduplicatedNodes,
      ways: patch.ways.size,
      relations: base.relations.size + patch.relations.size,
    });

    expect(directResult.nodes.ids.has(2)).toBe(true);
    expect(directResult.ways.getById(1)).toEqual({
      id: 1,
      refs: [0, 1],
      tags: {
        highway: "primary",
        version: "2",
      },
    });

    changeset = generateChangeset(base, patch, {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
    });
    const deduplicatedResult = applyChangesetToOsm(changeset, "deduplicated");

    // The immutable base node survives and receives non-conflicting patch tags.
    expect(deduplicatedResult.nodes.ids.has(0)).toBe(true);
    expect(deduplicatedResult.nodes.ids.has(2)).toBe(false);
    expect(deduplicatedResult.ways.getById(1)).toEqual({
      id: 1,
      refs: [0, 1],
      tags: {
        highway: "primary",
        version: "2",
      },
    });
    expect(deduplicatedResult.ways.getById(2)?.refs).toEqual([0, 3]);

    expect(deduplicatedResult.nodes.getById(0)).toEqual({
      id: 0,
      lat: 46.60207,
      lon: -120.505898,
      tags: {
        crossing: "yes",
      },
    });

    changeset = new OsmChangeset(deduplicatedResult);
    changeset.createIntersectionsForWays(patch.ways);

    expect(changeset.stats).toEqual({
      osmId: "deduplicated",
      totalChanges: 3,
      nodeChanges: 1,
      wayChanges: 2,
      relationChanges: 0,
      deduplicatedNodes: 0,
      deduplicatedNodesReplaced: 0,
      deduplicatedWays: 0,
      intersectionPointsFound: 1,
      intersectionNodesCreated: 1,
    });

    const intersectionResult = applyChangesetToOsm(changeset);
    expect(sizes(intersectionResult)).toEqual({
      nodes: patch.nodes.size + changeset.stats.intersectionNodesCreated - 1, // 1 node is de-duplicated
      ways: patch.ways.size,
      relations: base.relations.size + patch.relations.size,
    });
  });
});
