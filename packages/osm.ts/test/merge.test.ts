import { assert, describe, it } from "vitest"

import { Osm, type OsmNode } from "../src"
import { createBaseOsm, createPatchOsm } from "./mock-osm"
import { getFile } from "./utils"

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

describe("merge osm", () => {
	it(
		"should merge two real osm objects",
		{
			timeout: 100_000,
		},
		async () => {
			const osm1Name = "yakima-full.osm.pbf"
			const osm2Name = "yakima.osw.pbf"
			const osmMergedName = "yakima-merged.osm.pbf"

			const osm1Data = await getFile(osm1Name)
			const osm1 = await Osm.fromPbfData(osm1Data)
			assert.equal(osm1.nodes.getById(testNode.id), null)

			const osm2Data = await getFile(osm2Name)
			const osm2 = await Osm.fromPbfData(osm2Data)
			assert.deepEqual(osm2.nodes.getById(testNode.id), testNode)

			const changeset = osm1.generateChangeset(osm2)
			const nodeChanges = Object.values(changeset.nodeChanges)
			const wayChanges = Object.values(changeset.wayChanges)
			const relationChanges = Object.values(changeset.relationChanges)

			const testNodeWithCrossing = {
				...testNode,
				tags: {
					...testNode.tags,
					crossing: "yes",
				},
			}

			assert.equal(nodeChanges.length, 11_643)
			assert.deepEqual(nodeChanges[0], {
				changeType: "create",
				entity: testNodeWithCrossing,
			})

			assert.equal(wayChanges.length, 4_232)
			assert.equal(relationChanges.length, 0)

			assert.equal(changeset.stats.deduplicatedNodes, 0)
			assert.equal(changeset.stats.deduplicatedNodesReplaced, 0)
			assert.equal(changeset.stats.intersectionPointsFound, 3176)

			const merged = changeset.applyChanges()

			assert.equal(osm1.nodes.size + osm2.nodes.size, merged.nodes.size)
			assert.deepEqual(merged.nodes.getById(testNode.id), testNodeWithCrossing)
		},
	)

	it("should generate and apply osm changes", () => {
		const base = createBaseOsm()
		const patch = createPatchOsm()
		const changeset = base.generateChangeset(patch)
		const nodeChanges = Object.values(changeset.nodeChanges)

		assert.equal(nodeChanges.length, 7)
		assert.equal(nodeChanges[0]?.changeType, "delete") // deduplicate node

		const wayChanges = Object.values(changeset.wayChanges)
		assert.equal(wayChanges.length, 4)
		assert.equal(wayChanges[0]?.entity.id, 1)
		assert.equal(wayChanges[0]?.changeType, "modify")
		assert.equal(wayChanges[0]?.entity.tags?.highway, "primary")
		assert.equal(wayChanges[0]?.entity.refs.length, 3)

		assert.equal(changeset.stats.deduplicatedNodes, 1)
		assert.equal(changeset.stats.deduplicatedNodesReplaced, 1)
		assert.equal(changeset.stats.intersectionPointsFound, 1)

		const result = changeset.applyChanges()

		assert.equal(result.ways.getById(1)?.tags?.highway, "primary")
		assert.equal(result.ways.getById(2)?.refs.length, 2)
	})
})
