import type { Osm } from "@osmix/core"
import { type ProgressEvent, progressEvent } from "@osmix/shared/progress"
import { OsmChangeset } from "./changeset"
import type { OsmMergeOptions } from "./types"
import { changeStatsSummary } from "./utils"

/**
 * Run a full merge pipeline on two OSM datasets.
 * @param base - The base OSM dataset.
 * @param patch - The patch OSM dataset.
 * @param options - The merge options.
 * @returns The merged OSM dataset.
 */
export async function merge(
	base: Osm,
	patch: Osm,
	options: Partial<OsmMergeOptions> = {},
	onProgress: (progress: ProgressEvent) => void = console.log,
) {
	const log = (msg: string) => onProgress(progressEvent(msg))
	// De-duplicate nodes and ways in original datasets
	log("Deduplicating ways in base OSM...")
	let changeset = new OsmChangeset(base)
	changeset.deduplicateWays(base.ways)
	log(changeStatsSummary(changeset.stats))
	let modifiedBase = changeset.applyChanges()

	log("Deduplicating nodes in base OSM...")
	changeset = new OsmChangeset(modifiedBase)
	changeset.deduplicateNodes(modifiedBase.nodes)
	log(changeStatsSummary(changeset.stats))
	modifiedBase = changeset.applyChanges()

	log("Deduplicating ways in patch OSM...")
	changeset = new OsmChangeset(patch)
	changeset.deduplicateWays(patch.ways)
	log(changeStatsSummary(changeset.stats))
	let modifiedPatch = changeset.applyChanges()

	log("Deduplicating nodes in patch OSM...")
	changeset = new OsmChangeset(modifiedPatch)
	changeset.deduplicateNodes(modifiedPatch.nodes)
	log(changeStatsSummary(changeset.stats))
	modifiedPatch = changeset.applyChanges()

	// Generate direct changes
	if (options.directMerge) {
		log("Generating direct changes from patch OSM to base OSM...")
		changeset = new OsmChangeset(modifiedBase)
		changeset.generateDirectChanges(modifiedPatch)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	// De-duplicate nodes and ways in final dataset
	if (options.deduplicateWays) {
		log("Deduplicating ways in final dataset...")
		changeset = new OsmChangeset(modifiedBase)
		changeset.deduplicateWays(modifiedPatch.ways)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}
	if (options.deduplicateNodes) {
		log("Deduplicating nodes in final dataset...")
		changeset = new OsmChangeset(modifiedBase)
		changeset.deduplicateNodes(modifiedPatch.nodes)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	// Create intersections
	if (options.createIntersections) {
		log("Creating intersections in final dataset...")
		changeset = new OsmChangeset(modifiedBase)
		changeset.createIntersectionsForWays(modifiedPatch.ways)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	return modifiedBase
}
