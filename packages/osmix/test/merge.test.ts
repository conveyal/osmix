import { existsSync } from "node:fs"
import { OsmChangeset } from "@osmix/change"
import type { Osm } from "@osmix/core"
import {
	getFixtureFileReadStream,
	getFixturePath,
} from "@osmix/shared/test/fixtures"
import type { OsmNode } from "@osmix/shared/types"
import { assert, describe, it } from "vitest"
import { createOsmFromPbf } from "../src/pbf"

const testNode: OsmNode = {
	id: 2135545,
	lat: 46.5708361,
	lon: -120.5622905,
	tags: {
		barrier: "kerb",
		"ext:corner_id": "1-2",
		"ext:intersection_id": "51791186.0",
		"ext:ixn_id": "686813.527,5160370.0576",
		"ext:level_1": "4.0",
		"ext:link_type": "end",
		"ext:node_type": "curb",
		"ext:osm_version": "2",
		"ext:sw_id": "l_9247",
		kerb: "lowered",
		tactile_paving: "yes",
	},
}

const sizes = (osm: Osm) => ({
	nodes: osm.nodes.size,
	ways: osm.ways.size,
	relations: osm.relations.size,
})

describe("merge osm", () => {
	it.runIf(existsSync(getFixturePath("./yakima-full.osm.pbf")))(
		"should merge two real osm objects",
		{
			timeout: 10_000,
		},
		async () => {
			const osm1Name = "yakima-full.osm.pbf"
			const osm2Name = "yakima.osw.pbf"
			// const _osmMergedName = "yakima-merged.osm.pbf"

			const osm1Data = getFixtureFileReadStream(osm1Name)
			let baseOsm = await createOsmFromPbf(osm1Data, { id: osm1Name })
			assert.equal(baseOsm.nodes.getById(testNode.id), null)

			const osm2Data = getFixtureFileReadStream(osm2Name)
			const osm2 = await createOsmFromPbf(osm2Data, { id: osm2Name })
			assert.deepEqual(osm2.nodes.getById(testNode.id), testNode)

			const baseSizes = sizes(baseOsm)
			const patchSizes = sizes(osm2)

			let changeset = new OsmChangeset(baseOsm)
			changeset.generateDirectChanges(osm2)

			assert.deepEqual(changeset.stats, {
				osmId: baseOsm.id,
				totalChanges: 15_875,
				nodeChanges: 11_643,
				wayChanges: 4_232,
				relationChanges: 0,
				deduplicatedNodes: 0,
				deduplicatedNodesReplaced: 0,
				deduplicatedWays: 0,
				intersectionPointsFound: 0,
				intersectionNodesCreated: 0,
			})
			// These expected values are based on the yakima fixture files. If they change,
			// it may indicate a change in entity comparison logic (which uses dequal for
			// deep equality checks) or a change in the merge algorithm itself.

			baseOsm = changeset.applyChanges()
			assert.deepEqual(sizes(baseOsm), {
				nodes: baseSizes.nodes + patchSizes.nodes,
				ways: baseSizes.ways + patchSizes.ways,
				relations: baseSizes.relations + patchSizes.relations,
			})

			changeset = new OsmChangeset(baseOsm)
			changeset.createIntersectionsForWays(osm2.ways)

			assert.deepEqual(changeset.stats, {
				osmId: baseOsm.id,
				totalChanges: 9_536,
				nodeChanges: 4_967,
				wayChanges: 4_569,
				relationChanges: 0,
				deduplicatedNodes: 0,
				deduplicatedNodesReplaced: 0,
				deduplicatedWays: 0,
				intersectionPointsFound: 5_820,
				intersectionNodesCreated: 2_618,
			})

			baseOsm = changeset.applyChanges()

			assert.deepEqual(sizes(baseOsm), {
				nodes:
					baseSizes.nodes +
					patchSizes.nodes +
					changeset.stats.intersectionNodesCreated,
				ways: baseSizes.ways + patchSizes.ways,
				relations: baseSizes.relations + patchSizes.relations,
			})

			assert.deepEqual(baseOsm.nodes.getById(2135545), {
				...testNode,
				tags: {
					...testNode.tags,
					crossing: "yes",
				},
			})
		},
	)

	it.skip(
		"should merge seattle with deduplication",
		{
			timeout: 200_000,
		},
		async () => {
			const osm1Name = "seattle.osm.pbf"
			const osm2Name = "seattle-osw.pbf"

			let baseOsm = await createOsmFromPbf(getFixtureFileReadStream(osm1Name), {
				id: osm1Name,
			})
			const osm2 = await createOsmFromPbf(getFixtureFileReadStream(osm2Name), {
				id: osm2Name,
			})

			const baseSizes = {
				nodes: 2_658_358,
				ways: 533_675,
				relations: 7_513,
			}

			const patchSizes = {
				nodes: 1_529_956,
				ways: 546_928,
				relations: 0,
			}

			assert.deepEqual(sizes(baseOsm), baseSizes)
			assert.deepEqual(sizes(osm2), patchSizes)

			// Direct merge
			let changeset = new OsmChangeset(baseOsm)
			console.time("generateDirectChanges")
			changeset.generateDirectChanges(osm2)
			console.timeEnd("generateDirectChanges")

			assert.deepEqual(changeset.stats, {
				osmId: baseOsm.id,
				totalChanges: 0,
				nodeChanges: 0,
				wayChanges: 0,
				relationChanges: 0,
				deduplicatedNodes: 4_835,
				deduplicatedNodesReplaced: 7_542,
				deduplicatedWays: 1_282,
				intersectionPointsFound: 0,
				intersectionNodesCreated: 0,
			})

			console.time("applyChanges")
			baseOsm = changeset.applyChanges()
			console.timeEnd("applyChanges")

			const totalNodes =
				baseSizes.nodes + patchSizes.nodes - changeset.stats.deduplicatedNodes
			const totalWays =
				baseSizes.ways + patchSizes.ways - changeset.stats.deduplicatedWays - 1 // There is a duplicate way id
			assert.deepEqual(sizes(baseOsm), {
				nodes: totalNodes,
				ways: totalWays,
				relations: baseSizes.relations + patchSizes.relations,
			})

			// Create intersections
			changeset = new OsmChangeset(baseOsm)

			console.time("createIntersections")
			changeset.createIntersectionsForWays(osm2.ways)
			console.timeEnd("createIntersections")

			assert.deepEqual(changeset.stats, {
				osmId: baseOsm.id,
				totalChanges: 0,
				nodeChanges: 0,
				wayChanges: 0,
				relationChanges: 0,
				deduplicatedNodes: 0,
				deduplicatedNodesReplaced: 0,
				deduplicatedWays: 0,
				intersectionPointsFound: 1_014_446,
				intersectionNodesCreated: 243_795,
			})

			baseOsm = changeset.applyChanges()
			assert.deepEqual(sizes(baseOsm), {
				nodes: totalNodes + changeset.stats.intersectionNodesCreated,
				ways: totalWays,
				relations: baseSizes.relations + patchSizes.relations,
			})
		},
	)
})
