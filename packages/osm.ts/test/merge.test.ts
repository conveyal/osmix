import { assert, describe, it } from "vitest"
import { distance } from "@turf/turf"

import { Osm, createOsmPbfReader, type OsmNode } from "../src"
import { getConflictingIds, merge, OsmMergeTask } from "../src/merge"
import { getFile } from "./utils"
import { generateOsmChanges } from "../src/osm-change"
import { createBaseOsm, createPatchOsm } from "./mock-osm"
import NodeSpatialIndex from "../src/node-spatial-index"

describe("merge osm", () => {
	it.skip(
		"should merge two osm objects",
		{
			timeout: 100_000,
		},
		async () => {
			const osm1Name = "yakima-full.osm.pbf"
			const osm2Name = "yakima.osw.pbf"
			const osmMergedName = "yakima-merged.osm.pbf"

			const osm1Data = await getFile(osm1Name)
			const osm1Reader = await createOsmPbfReader(osm1Data)
			const osm1 = await Osm.fromPbfReader(osm1Reader)

			const osm2Data = await getFile(osm2Name)
			const osm2Reader = await createOsmPbfReader(osm2Data)
			const osm2 = await Osm.fromPbfReader(osm2Reader)

			const conflictingIds = getConflictingIds(osm1, osm2)
			assert.equal(conflictingIds.nodes.size, 0)
			assert.equal(conflictingIds.ways.size, 0)
			assert.equal(conflictingIds.relations.size, 0)

			const osmMerged = merge(osm1, osm2)
		},
	)

	it("should generate and apply osm changes", () => {
		const base = createBaseOsm()
		const patch = createPatchOsm()
		const changes = generateOsmChanges(base, patch)

		assert.equal(changes.length, 10)
		assert.equal(changes[0]?.changeType, "create")
		assert.equal(changes[6]?.changeType, "modify")

		base.applyChanges(changes)

		assert.equal(base.ways.get(1)?.tags?.key, "newValue")
		assert.equal(base.ways.get(2)?.refs.length, 2)
	})

	it("should find geographically overlapping nodes and merge them", () => {
		const base = createBaseOsm()
		const patch = createPatchOsm()
		base.merge(patch)

		assert.equal(base.nodes.size, 8)

		const baseNodeIndex = new NodeSpatialIndex(base.nodes)
		const overlapping = baseNodeIndex.findOverlappingNodes(patch.nodes)
		assert.equal(overlapping.size, 1)
		assert.equal(overlapping.get(1)?.size, 1)
		assert.equal(overlapping.get(1)?.has(2), true)

		// Deduplicate the nodes
		base.dedupeOverlappingNodes(patch.nodes)

		// One node should have been deleted
		assert.equal(base.nodes.size, 7)
		assert.equal(base.nodes.get(1), undefined)
	})

	function makePairKey(a: number, b: number): string {
		return [a, b].sort().join("|") // canonical key, "a|b" === "b|a"
	}

	function parsePairKey(key: string): [number, number] {
		const [a, b] = key.split("|")
		return [Number.parseInt(a ?? "0"), Number.parseInt(b ?? "0")]
	}

	it("should find intersecting ways and add an intersection", () => {
		const baseOsm = createBaseOsm()
		const patch = createPatchOsm()
		baseOsm.merge(patch)
		baseOsm.dedupeOverlappingNodes()

		const disconnectedWays = new Set<number>()
		const intersectingWays = new Set<string>()

		// Find intersecting way IDs. Each way should have at least one intersecting way or it is disconnected from the rest of the network.
		for (const [wayId] of patch.ways) {
			const intersectingWayIds = baseOsm.findIntersectingWayIds(wayId)
			if (intersectingWayIds.size > 0) {
				for (const intersectingWayId of intersectingWayIds) {
					intersectingWays.add(makePairKey(wayId, intersectingWayId))
				}
			} else {
				disconnectedWays.add(wayId)
			}
		}

		console.log(intersectingWays)
		assert.equal(intersectingWays.size, 3)
		assert.equal(intersectingWays.has("1|2"), true)
		assert.equal(disconnectedWays.size, 0)

		// Convert intersecting ways into intersecting nodes
		let insertions = 0
		for (const intersectingWayKey of intersectingWays) {
			const [wayId, intersectingWayId] = parsePairKey(intersectingWayKey)
			// Find the intersecting points of the two ways
			const intersectingPoints = baseOsm.findIntersectingPoints(
				wayId,
				intersectingWayId,
			)

			for (const point of intersectingPoints) {
				const [lon, lat] = point.geometry.coordinates as [number, number]
				const baseNode =
					baseOsm.nodeIndex.nodesWithin(lon, lat)[0] ??
					baseOsm.createNode(lon, lat)
				if (baseOsm.insertNodeIntoWay(wayId, baseNode.id)) insertions++
				if (baseOsm.insertNodeIntoWay(intersectingWayId, baseNode.id))
					insertions++
			}
		}

		assert.equal(insertions, 4)
	})
})
