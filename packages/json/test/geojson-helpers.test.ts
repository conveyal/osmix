import type { OsmNode, OsmRelation, OsmWay } from "@osmix/shared/types"
import { assert, describe, expect, it } from "vitest"
import { nodeToFeature, relationToFeature, wayToFeature } from "../src/geojson"

describe("geojson helpers", () => {
	const node0: OsmNode = { id: 1, lat: 0, lon: 0, tags: { amenity: "cafe" } }
	const node1: OsmNode = { id: 2, lat: 1, lon: 1 }
	const nodes: OsmNode[] = [node0, node1]
	const nodeMap = new Map(nodes.map((n) => [n.id, n]))
	const refToPosition = (id: number) => {
		const node = nodeMap.get(id)
		if (!node) throw new Error(`Node ${id} not found`)
		return [node.lon, node.lat] as [number, number]
	}

	it("converts node to GeoJSON Point", () => {
		const feature = nodeToFeature(node0)
		expect(feature.type).toBe("Feature")
		expect(feature.geometry.type).toBe("Point")
		expect(feature.geometry.coordinates).toEqual([node0.lon, node0.lat])
		expect(feature.properties).toEqual({
			id: node0.id,
			type: "node",
			...node0.tags,
			...node0.info,
		})
	})

	it("creates polygon for closed ways", () => {
		const way: OsmWay = {
			id: 10,
			refs: [1, 2, 1],
			tags: { area: "yes" },
		}
		const feature = wayToFeature(way, refToPosition)
		expect(feature.geometry.type).toBe("Polygon")
	})

	it("builds relation geometry collection", () => {
		// Create a way that forms a closed ring
		const way: OsmWay = {
			id: 10,
			refs: [1, 2, 1], // Closed way
			tags: { area: "yes" },
		}
		const wayMap = new Map([[way.id, way]])
		const getWay = (wayId: number) => wayMap.get(wayId) ?? null

		const relation: OsmRelation = {
			id: 20,
			members: [{ type: "way", ref: 10, role: "outer" }],
			tags: { type: "multipolygon" },
		}
		const feature = relationToFeature(relation, refToPosition, getWay)
		expect(feature.geometry.type).toBe("Polygon")
		const polygon = feature.geometry
		assert.exists(polygon.coordinates?.[0])
		expect(polygon.coordinates[0]).toHaveLength(3) // Should have 3 coordinates (closed ring)
	})
})
