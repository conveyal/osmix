/**
 * Changeset generation with progress tracking.
 *
 * Creates changesets from patch datasets with configurable operations
 * (direct merge, deduplication, intersection creation) and progress callbacks.
 *
 * @module
 */

import type { Osm } from "@osmix/core";
import { logProgress, type ProgressEvent, progressEvent } from "@osmix/shared/progress";
import { throttle } from "@osmix/shared/throttle";

import { OsmChangeset } from "./changeset.ts";
import type { OsmMergeOptions } from "./types.ts";

/**
 * Generate a changeset from a patch dataset with configurable operations.
 *
 * Unlike `merge()`, this function returns the changeset itself rather than
 * applying it. Useful when you need to inspect or modify changes before applying.
 *
 * @param base - The base OSM dataset.
 * @param patch - The patch OSM dataset to generate changes from.
 * @param options - Options controlling which operations to run.
 * @param onProgress - Callback for progress updates (throttled for way operations).
 * @returns The populated OsmChangeset ready for application or inspection.
 * @throws When direct merge and intersection creation are requested together. Newly created
 * patch ways are not spatially indexed until the direct changeset is applied; use `merge()` or
 * apply the direct changes before generating an intersection-only changeset.
 *
 * @example
 * ```ts
 * const changeset = generateChangeset(baseOsm, patchOsm, {
 *   directMerge: true,
 *   deduplicateNodes: true,
 * })
 * console.log(changeStatsSummary(changeset.stats))
 * const merged = applyChangesetToOsm(changeset)
 * ```
 */
export function generateChangeset(
  base: Osm,
  patch: Osm,
  options: Partial<OsmMergeOptions> = {},
  onProgress: (progress: ProgressEvent) => void = logProgress,
) {
  if (options.directMerge && options.createIntersections) {
    throw Error(
      "generateChangeset cannot combine directMerge with createIntersections because new patch ways are not indexed; use merge() or apply direct changes before generating intersections",
    );
  }

  const patchId = patch.id;
  const baseId = base.id;

  const log = (msg: string) => onProgress(progressEvent(msg));

  const changeset = new OsmChangeset(base);
  const logEverySecond = throttle((msg: string) => log(msg), 1_000);

  if (options.directMerge) {
    log(`Generating direct changes from ${patchId} to ${baseId}...`);
    changeset.generateDirectChanges(patch);
  }

  if (options.deduplicateNodes) {
    log(`Reconciling nodes from ${patchId} with ${baseId}...`);
    changeset.deduplicateNodes(patch.nodes);
    log(
      `Node deduplication results: ${changeset.deduplicatedNodes} de-duplicated nodes, ${changeset.deduplicatedNodesReplaced} nodes replaced`,
    );
  }

  if (options.deduplicateWays) {
    let checkedWays = 0;
    let dedpulicatedWays = 0;
    log(`Reconciling ways from ${patchId} with ${baseId}...`);
    for (const wayStats of changeset.deduplicateWaysGenerator(patch.ways)) {
      checkedWays++;
      dedpulicatedWays += wayStats;
      logEverySecond(
        `Way reconciliation: ${checkedWays.toLocaleString()} ways checked, ${dedpulicatedWays.toLocaleString()} ways reconciled`,
      );
    }
  }

  if (options.createIntersections) {
    let checkedWays = 0;
    log(`Creating intersections from ${patchId}...`);

    // This will check if the osm dataset has the way before trying to create intersections for it.
    for (const _wayStats of changeset.createIntersectionsForWaysGenerator(patch.ways)) {
      checkedWays++;
      logEverySecond(
        `Intersection creation progress: ${checkedWays.toLocaleString()} ways checked`,
      );
    }
  }

  return changeset;
}
