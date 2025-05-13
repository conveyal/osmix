import type { Osmix } from "@osmix/core"
import { OsmixChangeset } from "./changeset"
import type { OsmixMergeOptions } from "./types"
import { changeStatsSummary } from "./utils"

export async function merge(
	base: Osmix,
	patch: Osmix,
	options: Partial<OsmixMergeOptions> = {},
) {
	// De-duplicate nodes and ways in original datasets
	base.log("Deduplicating ways in base OSM...")
	let changeset = new OsmixChangeset(base)
	changeset.deduplicateWays(base.ways)
	base.log(changeStatsSummary(changeset.stats))
	let modifiedBase = changeset.applyChanges()

	modifiedBase.log("Deduplicating nodes in base OSM...")
	changeset = new OsmixChangeset(modifiedBase)
	changeset.deduplicateNodes(modifiedBase.nodes)
	modifiedBase.log(changeStatsSummary(changeset.stats))
	modifiedBase = changeset.applyChanges()

	patch.log("Deduplicating ways in patch OSM...")
	changeset = new OsmixChangeset(patch)
	changeset.deduplicateWays(patch.ways)
	patch.log(changeStatsSummary(changeset.stats))
	let modifiedPatch = changeset.applyChanges()

	modifiedPatch.log("Deduplicating nodes in patch OSM...")
	changeset = new OsmixChangeset(modifiedPatch)
	changeset.deduplicateNodes(modifiedPatch.nodes)
	modifiedPatch.log(changeStatsSummary(changeset.stats))
	modifiedPatch = changeset.applyChanges()

	// Generate direct changes
	if (options.directMerge) {
		modifiedBase.log("Generating direct changes from patch OSM to base OSM...")
		changeset = new OsmixChangeset(modifiedBase)
		changeset.generateDirectChanges(modifiedPatch)
		modifiedBase.log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	// De-duplicate nodes and ways in final dataset
	if (options.deduplicateWays) {
		modifiedBase.log("Deduplicating ways in final dataset...")
		changeset = new OsmixChangeset(modifiedBase)
		changeset.deduplicateWays(modifiedPatch.ways)
		modifiedBase.log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}
	if (options.deduplicateNodes) {
		modifiedBase.log("Deduplicating nodes in final dataset...")
		changeset = new OsmixChangeset(modifiedBase)
		changeset.deduplicateNodes(modifiedPatch.nodes)
		modifiedBase.log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	// Create intersections
	if (options.createIntersections) {
		modifiedBase.log("Creating intersections in final dataset...")
		changeset = new OsmixChangeset(modifiedBase)
		changeset.createIntersectionsForWays(modifiedPatch.ways)
		modifiedBase.log(changeStatsSummary(changeset.stats))
		modifiedBase = changeset.applyChanges()
	}

	return modifiedBase
}
