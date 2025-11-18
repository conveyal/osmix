import type { Osm } from "@osmix/core"
import { type ProgressEvent, progressEvent } from "@osmix/shared/progress"
import { throttle } from "@osmix/shared/throttle"
import { OsmChangeset } from "./changeset"
import type { OsmMergeOptions } from "./types"

export function generateChangeset(
	base: Osm,
	patch: Osm,
	options: Partial<OsmMergeOptions> = {},
	onProgress: (progress: ProgressEvent) => void = console.log,
) {
	const patchId = patch.id
	const baseId = base.id

	const log = (msg: string) => onProgress(progressEvent(msg))

	const changeset = new OsmChangeset(base)
	const logEverySecond = throttle((msg: string) => log(msg), 1_000)

	if (options.directMerge) {
		log(`Generating direct changes from ${patchId} to ${baseId}...`)
		changeset.generateDirectChanges(patch)
	}

	if (options.deduplicateWays) {
		let checkedWays = 0
		let dedpulicatedWays = 0
		log(`Deduplicating ways from ${patchId}...`)
		for (const wayStats of changeset.deduplicateWaysGenerator(patch.ways)) {
			checkedWays++
			dedpulicatedWays += wayStats
			logEverySecond(
				`Deduplicating ways: ${checkedWays.toLocaleString()} ways checked, ${dedpulicatedWays.toLocaleString()} ways deduplicated`,
			)
		}
	}

	if (options.deduplicateNodes) {
		log(`Deduplicating nodes from ${patchId}...`)
		changeset.deduplicateNodes(patch.nodes)
		log(
			`Node deduplication results: ${changeset.deduplicatedNodes} de-duplicated nodes, ${changeset.deduplicatedNodesReplaced} nodes replaced`,
		)
	}

	if (options.createIntersections) {
		let checkedWays = 0
		log(`Creating intersections from ${patchId}...`)

		// This will check if the osm dataset has the way before trying to create intersections for it.
		for (const _wayStats of changeset.createIntersectionsForWaysGenerator(
			patch.ways,
		)) {
			checkedWays++
			logEverySecond(
				`Intersection creation progress: ${checkedWays.toLocaleString()} ways checked`,
			)
		}
	}

	return changeset
}
