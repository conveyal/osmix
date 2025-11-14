import type { Osm } from "@osmix/core"
import { createBaseOsm, createPatchOsm } from "@osmix/core/test/mock-osm"
import { assert, describe, it } from "vitest"
import { OsmChangeset } from "../src/changeset"

const sizes = (osm: Osm) => ({
	nodes: osm.nodes.size,
	ways: osm.ways.size,
	relations: osm.relations.size,
})

describe("merge osm", () => {
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
			osmId: base.id,
			totalChanges: 10,
			nodeChanges: 6,
			wayChanges: 4,
			relationChanges: 0,
			deduplicatedNodes: 0,
			deduplicatedNodesReplaced: 0,
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

		assert.isTrue(directResult.nodes.ids.has(2))
		assert.deepEqual(directResult.ways.getById(1), {
			id: 1,
			refs: [0, 1],
			tags: {
				highway: "primary",
				version: "2",
			},
		})

		changeset = new OsmChangeset(directResult)
		changeset.deduplicateWays(patch.ways)
		changeset.deduplicateNodes(patch.nodes)
		const deduplicatedResult = changeset.applyChanges("deduplicated")

		// Node 0 is deleted because node 2 has more tags (version/tags logic)
		assert.isFalse(deduplicatedResult.nodes.ids.has(0))
		assert.deepEqual(deduplicatedResult.ways.getById(1), {
			id: 1,
			refs: [2, 1], // Node 0 replaced with node 2
			tags: {
				highway: "primary",
				version: "2",
			},
		})

		// Node 2 is kept because it has tags
		assert.deepEqual(deduplicatedResult.nodes.getById(2), {
			id: 2,
			lat: 46.60207,
			lon: -120.505898,
			tags: {
				crossing: "yes",
			},
		})

		changeset = new OsmChangeset(deduplicatedResult)
		changeset.createIntersectionsForWays(patch.ways)

		assert.deepEqual(changeset.stats, {
			osmId: "deduplicated",
			totalChanges: 3,
			nodeChanges: 1,
			wayChanges: 2,
			relationChanges: 0,
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
})
