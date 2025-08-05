import { assert, describe, it } from "vitest"

import { Osm } from "../src"
import { mergeOsm } from "../src/merge"
import { generateOsmChanges } from "../src/osm-change"
import { createBaseOsm, createPatchOsm } from "./mock-osm"
import { getFile } from "./utils"

describe("merge osm", () => {
	it.only(
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

			const osm2Data = await getFile(osm2Name)
			const osm2 = await Osm.fromPbfData(osm2Data)

			const osmMerged = mergeOsm(osm1, osm2)
		},
	)

	it("should generate and apply osm changes", () => {
		const base = createBaseOsm()
		const patch = createPatchOsm()
		const changes = generateOsmChanges(base, patch)

		console.error(changes)
		assert.equal(changes.length, 9)
		assert.equal(changes[0]?.changeType, "create")

		base.applyChanges(changes)

		assert.equal(base.ways.getById(1)?.tags?.key, "newValue")
		assert.equal(base.ways.getById(2)?.refs.length, 2)
	})

	it("should find geographically overlapping nodes and merge them", () => {
		const base = createBaseOsm()
		const patch = createPatchOsm()
		const changes = generateOsmChanges(base, patch)
		base.applyChanges(changes)

		assert.equal(base.nodes.size, 8)

		const overlapping = base.nodes.findOverlappingNodes(Array.from(patch.nodes))
		console.log(overlapping)
		assert.equal(overlapping.size, 1)
		assert.equal(overlapping.get(1)?.size, 1)
		assert.equal(overlapping.get(1)?.has(2), true)

		// Deduplicate the nodes
		const results = base.dedupeOverlappingNodes(patch.nodes)

		assert.equal(results.replaced, 1)
		assert.equal(results.deleted, 1)

		// One node should have been deleted
		assert.equal(base.nodes.size, 7)
		assert.equal(base.nodes.getById(1), undefined)

		// The way should have been updated to use the new node
		assert.equal(base.ways.getById(1)?.refs[1], 2)
	})

	function makePairKey(a: number, b: number): string {
		return [a, b].sort().join("|") // canonical key, "a|b" === "b|a"
	}

	function parsePairKey(key: string): [number, number] {
		const [a, b] = key.split("|")
		return [Number.parseInt(a ?? "0"), Number.parseInt(b ?? "0")]
	}

	it("should find intersecting ways and add intersections", () => {
		const baseOsm = createBaseOsm()
		const patch = createPatchOsm()
		const changes = generateOsmChanges(baseOsm, patch)
		baseOsm.applyChanges(changes)

		baseOsm.dedupeOverlappingNodes()

		const disconnectedWays = new Set<number>()
		const intersectingWayPairs = new Map<
			string,
			GeoJSON.Feature<GeoJSON.Point>[]
		>()

		const intersections = baseOsm.findIntersectionCandidatesForOsm(patch)
		console.log(intersections)

		// Find intersecting way IDs. Each way should have at least one intersecting way or it is disconnected from the rest of the network.
		for (const way of patch.ways) {
			const lineString = patch.ways.getLineString({ id: way.id })
			const intersectingWayIds = baseOsm.findIntersectingWays(lineString)
			if (intersectingWayIds.size > 0) {
				for (const [intersectingWayId, intersections] of intersectingWayIds) {
					intersectingWayPairs.set(
						makePairKey(way.id, intersectingWayId),
						intersections,
					)
				}
			} else {
				if (!baseOsm.isWayDisconnected(lineString)) {
					disconnectedWays.add(way.id)
				}
			}
		}

		assert.equal(intersectingWayPairs.size, 2)
		assert.equal(intersectingWayPairs.has("1|3"), true)
		assert.equal(intersectingWayPairs.has("1|4"), true)

		assert.equal(disconnectedWays.size, 0)

		// Convert intersecting ways into intersecting nodes
		let insertions = 0
		for (const [intersectingWayKey, intersections] of intersectingWayPairs) {
			const [wayId, intersectingWayId] = parsePairKey(intersectingWayKey)
			for (const { coords, existingNode } of intersections.map((p) =>
				baseOsm.pointToNode(p),
			)) {
				const node = existingNode ?? baseOsm.createNode(coords)
				if (baseOsm.insertNodeIntoWay(node.id, wayId)) insertions++
				if (baseOsm.insertNodeIntoWay(node.id, intersectingWayId)) insertions++
			}
		}

		assert.equal(insertions, 4)
	})

	it("should fully merge two osm objects", () => {
		const base = createBaseOsm()
		const patch = createPatchOsm()
		const merged = mergeOsm(base, patch)

		assert.equal(merged.nodes.size, 8)
		assert.equal(merged.ways.size, 4)
		assert.equal(merged.relations.size, 0)
	})
})
