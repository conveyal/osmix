import { describe, expect, it } from "bun:test"
import type { Osm } from "@osmix/core"
import { createMockBaseOsm, createMockPatchOsm } from "@osmix/core"
import { applyChangesetToOsm } from "../src/apply-changeset"
import { OsmChangeset } from "../src/changeset"

const sizes = (osm: Osm) => ({
	nodes: osm.nodes.size,
	ways: osm.ways.size,
	relations: osm.relations.size,
})

describe("merge osm", () => {
	it("should generate and apply osm changes", () => {
		const base = createMockBaseOsm()
		const patch = createMockPatchOsm()

		expect(sizes(base)).toEqual({
			nodes: 2,
			ways: 1,
			relations: 0,
		})
		expect(sizes(patch)).toEqual({
			nodes: 8,
			ways: 4,
			relations: 0,
		})

		let changeset = new OsmChangeset(base)
		changeset.generateDirectChanges(patch)
		expect(changeset.stats).toEqual({
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

		const directResult = applyChangesetToOsm(changeset)
		expect(sizes(directResult)).toEqual({
			nodes: patch.nodes.size - changeset.stats.deduplicatedNodes,
			ways: patch.ways.size,
			relations: base.relations.size + patch.relations.size,
		})

		expect(directResult.nodes.ids.has(2)).toBe(true)
		expect(directResult.ways.getById(1)).toEqual({
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
		const deduplicatedResult = applyChangesetToOsm(changeset, "deduplicated")

		// Node 0 is deleted because node 2 has more tags (version/tags logic)
		expect(deduplicatedResult.nodes.ids.has(0)).toBe(false)
		expect(deduplicatedResult.ways.getById(1)).toEqual({
			id: 1,
			refs: [2, 1], // Node 0 replaced with node 2
			tags: {
				highway: "primary",
				version: "2",
			},
		})

		// Node 2 is kept because it has tags
		expect(deduplicatedResult.nodes.getById(2)).toEqual({
			id: 2,
			lat: 46.60207,
			lon: -120.505898,
			tags: {
				crossing: "yes",
			},
		})

		changeset = new OsmChangeset(deduplicatedResult)
		changeset.createIntersectionsForWays(patch.ways)

		expect(changeset.stats).toEqual({
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

		const intersectionResult = applyChangesetToOsm(changeset)
		expect(sizes(intersectionResult)).toEqual({
			nodes: patch.nodes.size + changeset.stats.intersectionNodesCreated - 1, // 1 node is de-duplicated
			ways: patch.ways.size,
			relations: base.relations.size + patch.relations.size,
		})
	})
})
