/**
 * High-level merge pipeline for OSM datasets.
 *
 * Orchestrates a complete merge workflow including deduplication of nodes and ways
 * in both datasets, direct change generation, and optional intersection creation.
 *
 * @module
 */

import type { Osm } from "@osmix/core"
import {
	logProgress,
	type ProgressEvent,
	progressEvent,
} from "@osmix/shared/progress"
import { applyChangesetToOsm } from "./apply-changeset"
import { OsmChangeset } from "./changeset"
import type { OsmMergeOptions } from "./types"
import { changeStatsSummary } from "./utils"

/**
 * Run a full merge pipeline on two OSM datasets.
 *
 * Executes a multi-stage merge process:
 * 1. Deduplicates nodes and ways in both base and patch datasets
 * 2. Optionally generates direct changes from patch to base (`directMerge`)
 * 3. Optionally deduplicates nodes/ways in the final merged dataset
 * 4. Optionally creates intersection nodes where ways cross
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
	const log = (msg: string) => onProgress(progressEvent(msg))
	// De-duplicate nodes and ways in original datasets
	log("Deduplicating ways in base OSM...")
	let changeset = new OsmChangeset(base)
	changeset.deduplicateWays(base.ways)
	log(changeStatsSummary(changeset.stats))
	let modifiedBase = applyChangesetToOsm(changeset)

	log("Deduplicating nodes in base OSM...")
	changeset = new OsmChangeset(modifiedBase)
	changeset.deduplicateNodes(modifiedBase.nodes)
	log(changeStatsSummary(changeset.stats))
	modifiedBase = applyChangesetToOsm(changeset)

	log("Deduplicating ways in patch OSM...")
	changeset = new OsmChangeset(patch)
	changeset.deduplicateWays(patch.ways)
	log(changeStatsSummary(changeset.stats))
	let modifiedPatch = applyChangesetToOsm(changeset)

	log("Deduplicating nodes in patch OSM...")
	changeset = new OsmChangeset(modifiedPatch)
	changeset.deduplicateNodes(modifiedPatch.nodes)
	log(changeStatsSummary(changeset.stats))
	modifiedPatch = applyChangesetToOsm(changeset)

	// Generate direct changes
	if (options.directMerge) {
		log("Generating direct changes from patch OSM to base OSM...")
		changeset = new OsmChangeset(modifiedBase)
		changeset.generateDirectChanges(modifiedPatch)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = applyChangesetToOsm(changeset)
	}

	// De-duplicate nodes and ways in final dataset
	if (options.deduplicateWays) {
		log("Deduplicating ways in final dataset...")
		changeset = new OsmChangeset(modifiedBase)
		changeset.deduplicateWays(modifiedPatch.ways)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = applyChangesetToOsm(changeset)
	}
	if (options.deduplicateNodes) {
		log("Deduplicating nodes in final dataset...")
		changeset = new OsmChangeset(modifiedBase)
		changeset.deduplicateNodes(modifiedPatch.nodes)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = applyChangesetToOsm(changeset)
	}

	// Create intersections
	if (options.createIntersections) {
		log("Creating intersections in final dataset...")
		changeset = new OsmChangeset(modifiedBase)
		changeset.createIntersectionsForWays(modifiedPatch.ways)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = applyChangesetToOsm(changeset)
	}

	return modifiedBase
}
