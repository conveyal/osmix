import type { Osm } from "@osmix/core";

import { OsmChangeset } from "../../src/changeset.ts";

/**
 * The planner's change store driven one stage at a time, for tests of the stages themselves.
 * `merge` and `planMerge` are the supported way to merge; this exercises their building blocks.
 */
export function stagedChanges(
  base: Osm,
  patch: Osm,
  stages: {
    directMerge?: boolean;
    deduplicateNodes?: boolean;
    deduplicateWays?: boolean;
    createIntersections?: boolean;
  } = {},
) {
  const changeset = new OsmChangeset(base);
  if (stages.directMerge) changeset.generateDirectChanges(patch);
  if (stages.deduplicateNodes) changeset.deduplicateNodes(patch.nodes);
  if (stages.deduplicateWays) changeset.deduplicateWays(patch.ways);
  if (stages.createIntersections) changeset.createIntersectionsForWays(patch.ways, patch.nodes.ids);
  return changeset;
}
