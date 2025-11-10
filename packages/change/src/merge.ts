import type { Osmix } from "@osmix/core"
import { OsmixChangeset } from "./changeset"
import type { OsmixMergeOptions } from "./types"
import { changeStatsSummary } from "./utils"

export async function merge(
	base: Osmix,
	patch: Osmix,
	options: Partial<OsmixMergeOptions> = {},
) {
	const log = options.logger ?? ((...msg) => console.log(...msg))
	// De-duplicate nodes and ways in original datasets
	log("Deduplicating ways in base OSM...")
	let changeset = new OsmixChangeset(base)
	changeset.deduplicateWays(base.ways)
	log(changeStatsSummary(changeset.stats))
	let modifiedBase = changeset.applyChanges()

	log("Deduplicating nodes in base OSM...")
	changeset = new OsmixChangeset(modifiedBase)
	changeset.deduplicateNodes(modifiedBase.nodes)
	log(changeStatsSummary(changeset.stats))
	modifiedBase = changeset.applyChanges()

	log("Deduplicating ways in patch OSM...")
	changeset = new OsmixChangeset(patch)
	changeset.deduplicateWays(patch.ways)
	log(changeStatsSummary(changeset.stats))
	let modifiedPatch = changeset.applyChanges()

	log("Deduplicating nodes in patch OSM...")
	changeset = new OsmixChangeset(modifiedPatch)
	changeset.deduplicateNodes(modifiedPatch.nodes)
	log(changeStatsSummary(changeset.stats))
	modifiedPatch = changeset.applyChanges()

	// Generate direct changes
	if (options.directMerge) {
		log("Generating direct changes from patch OSM to base OSM...")
		changeset = new OsmixChangeset(modifiedBase)
		changeset.generateDirectChanges(modifiedPatch)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	// De-duplicate nodes and ways in final dataset
	if (options.deduplicateWays) {
		log("Deduplicating ways in final dataset...")
		changeset = new OsmixChangeset(modifiedBase)
		changeset.deduplicateWays(modifiedPatch.ways)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}
	if (options.deduplicateNodes) {
		log("Deduplicating nodes in final dataset...")
		changeset = new OsmixChangeset(modifiedBase)
		changeset.deduplicateNodes(modifiedPatch.nodes)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	// Create intersections
	if (options.createIntersections) {
		log("Creating intersections in final dataset...")
		changeset = new OsmixChangeset(modifiedBase)
		changeset.createIntersectionsForWays(modifiedPatch.ways)
		log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	return modifiedBase
}
