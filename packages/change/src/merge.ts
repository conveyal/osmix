/**
 * High-level merge pipeline for OSM datasets.
 *
 * Orchestrates direct change generation, conservative cross-dataset reconciliation,
 * and optional intersection creation.
 *
 * @module
 */

import type { Osm } from "@osmix/core";
import { logProgress, type ProgressEvent, progressEvent } from "@osmix/shared/progress";

import { applyChangesetToOsm } from "./apply-changeset.ts";
import { OsmChangeset } from "./changeset.ts";
import {
  discoverConflationCandidates,
  generateConflationApplicationChangeset,
} from "./conflation.ts";
import { generateChangeset } from "./generate-changeset.ts";
import { assertConflationPreservesBaseTopology } from "./integrity.ts";
import type { OsmMergeOptions } from "./types.ts";
import { changeStatsSummary } from "./utils.ts";

/**
 * Run a full merge pipeline on two OSM datasets.
 *
 * Executes a multi-stage merge process:
 * 1. Optionally generates direct changes from patch to base (`directMerge`)
 * 2. Optionally reconciles coincident patch nodes/ways with base entities
 * 3. Optionally creates intersection nodes where ways cross
 * 4. Verifies that the merge introduced no new routing-integrity problems
 *
 * @param base - The base OSM dataset to merge into.
 * @param patch - The patch OSM dataset to merge from.
 * @param options - Merge options controlling which stages to run.
 * @param onProgress - Callback for progress updates during merge.
 * @returns The merged OSM dataset with all changes applied.
 *
 * @example
 * ```ts
 * const merged = await merge(baseOsm, patchOsm, {
 *   directMerge: true,
 *   deduplicateNodes: true,
 *   deduplicateWays: true,
 *   createIntersections: false,
 * })
 * ```
 */
export async function merge(
  base: Osm,
  patch: Osm,
  options: Partial<OsmMergeOptions> = {},
  onProgress: (progress: ProgressEvent) => void = logProgress,
) {
  const log = (msg: string) => onProgress(progressEvent(msg));
  let modifiedBase = base;

  // Generate direct changes and reconcile against the original, immutable base in
  // one changeset. This keeps patch entities out of the base candidate pool.
  if (options.directMerge || options.deduplicateNodes || options.deduplicateWays) {
    const changeset = generateChangeset(
      base,
      patch,
      {
        directMerge: options.directMerge ?? false,
        deduplicateNodes: options.deduplicateNodes ?? false,
        deduplicateWays: options.deduplicateWays ?? false,
        createIntersections: false,
      },
      onProgress,
    );
    log(changeStatsSummary(changeset.stats));
    modifiedBase = applyChangesetToOsm(changeset);
  }

  if (options.conflation) {
    if (!options.directMerge) {
      throw Error("Fuzzy conflation requires directMerge to preserve unmatched patch entities");
    }
    log(`Discovering imported-data matches from ${patch.id} against ${base.id}...`);
    // Fuzzy discovery always sees untouched inputs. The ordinary result is only the
    // application baseline, preventing transitive matches through imported entities.
    const discovery = discoverConflationCandidates(base, patch, options.conflation);
    const ordinaryBaseline = modifiedBase;
    const changeset = generateConflationApplicationChangeset(
      ordinaryBaseline,
      patch,
      discovery,
      base,
      options.conflation.decisions,
    );
    modifiedBase = applyChangesetToOsm(changeset);
    assertConflationPreservesBaseTopology(base, ordinaryBaseline, modifiedBase);
    log(
      `Conflation candidates: ${discovery.summary.automatic.toLocaleString()} automatic, ${discovery.summary.review.toLocaleString()} review, ${discovery.summary.blocked.toLocaleString()} blocked, ${discovery.summary.unmatched.toLocaleString()} unmatched`,
    );
  }

  // Intersections run after conflation so accepted patch attachments participate in
  // crossing insertion, while candidate discovery remains based on untouched inputs.
  if (options.createIntersections) {
    log("Creating intersections in final dataset...");
    const changeset = new OsmChangeset(modifiedBase);
    changeset.createIntersectionsForWays(patch.ways);
    log(changeStatsSummary(changeset.stats));
    modifiedBase = applyChangesetToOsm(changeset);
  }

  return modifiedBase;
}
