import { getFixtureFileReadStream } from "@osmix/test-utils/fixtures"
import { assert, describe, it } from "vitest"
import {
	createOsmIndexFromPbfData,
	type Osm,
	OsmChangeset,
	type OsmNode,
} from "../src"
import { createBaseOsm, createPatchOsm } from "./mock-osm"

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
	it("should merge two real osm objects", async () => {
		const osm1Name = "yakima-full.osm.pbf"
		const osm2Name = "yakima.osw.pbf"
		const osmMergedName = "yakima-merged.osm.pbf"

		const osm1Data = getFixtureFileReadStream(osm1Name)
		let baseOsm = await createOsmIndexFromPbfData(osm1Data, osm1Name)
		assert.equal(baseOsm.nodes.getById(testNode.id), null)

		const osm2Data = getFixtureFileReadStream(osm2Name)
		const osm2 = await createOsmIndexFromPbfData(osm2Data, osm2Name)
		assert.deepEqual(osm2.nodes.getById(testNode.id), testNode)

		const baseSizes = sizes(baseOsm)
		const patchSizes = sizes(osm2)

		let changeset = new OsmChangeset(baseOsm)
		changeset.generateDirectChanges(osm2)

		assert.deepEqual(changeset.stats, {
			deduplicatedNodes: 0,
			deduplicatedNodesReplaced: 0,
			deduplicatedWays: 0,
			intersectionPointsFound: 0,
			intersectionNodesCreated: 0,
		}) // TODO did this break with new dequal? Or what?

		baseOsm = changeset.applyChanges()
		assert.deepEqual(sizes(baseOsm), {
			nodes: baseSizes.nodes + patchSizes.nodes,
			ways: baseSizes.ways + patchSizes.ways,
			relations: baseSizes.relations + patchSizes.relations,
		})

		changeset = new OsmChangeset(baseOsm)
		changeset.createIntersectionsForWays(osm2.ways)

		assert.deepEqual(changeset.stats, {
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
	})

	it("should generate and apply osm changes", () => {
		const base = createBaseOsm()
		const patch = createPatchOsm()

		assert.deepEqual(sizes(base), {
			nodes: 2,
			ways: 1,
			relations: 0,
		})
		assert.deepEqual(sizes(patch), {
			nodes: 8,
			ways: 4,
			relations: 0,
		})

		let changeset = new OsmChangeset(base)
		changeset.generateDirectChanges(patch)
		assert.deepEqual(changeset.stats, {
			deduplicatedNodes: 1,
			deduplicatedNodesReplaced: 1,
			deduplicatedWays: 0,
			intersectionPointsFound: 0,
			intersectionNodesCreated: 0,
		})

		const directResult = changeset.applyChanges()
		assert.deepEqual(sizes(directResult), {
			nodes: patch.nodes.size - changeset.stats.deduplicatedNodes,
			ways: patch.ways.size,
			relations: base.relations.size + patch.relations.size,
		})

		assert.deepEqual(directResult.ways.getById(1), {
			id: 1,
			refs: [2, 1],
			tags: {
				highway: "primary",
				version: "2",
			},
		})

		assert.isNull(directResult.nodes.getById(0))
		assert.deepEqual(directResult.nodes.getById(2), {
			id: 2,
			lat: 46.60207,
			lon: -120.505898,
		})

		changeset = new OsmChangeset(directResult)
		changeset.createIntersectionsForWays(patch.ways)

		assert.deepEqual(changeset.stats, {
			deduplicatedNodes: 0,
			deduplicatedNodesReplaced: 0,
			deduplicatedWays: 0,
			intersectionPointsFound: 1,
			intersectionNodesCreated: 1,
		})

		const intersectionResult = changeset.applyChanges()
		assert.deepEqual(sizes(intersectionResult), {
			nodes: patch.nodes.size + changeset.stats.intersectionNodesCreated - 1, // 1 node is de-duplicated
			ways: patch.ways.size,
			relations: base.relations.size + patch.relations.size,
		})
	})

	it.skip(
		"should merge seattle with deduplication",
		{
			timeout: 200_000,
		},
		async () => {
			const osm1Name = "seattle.osm.pbf"
			const osm2Name = "seattle-osw.pbf"

			let baseOsm = await createOsmIndexFromPbfData(
				getFixtureFileReadStream(osm1Name),
				osm1Name,
			)
			const osm2 = await createOsmIndexFromPbfData(
				getFixtureFileReadStream(osm2Name),
				osm2Name,
			)

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
