import { describe, expect, it } from "vitest"
import {
	nodeToFeature,
	nodesToFeatures,
	relationToFeature,
	wayToEditableGeoJson,
	wayToFeature,
	waysToFeatures,
} from "../src/geojson"
import type { OsmNode, OsmRelation, OsmWay } from "../src/types"

describe("geojson helpers", () => {
	const nodes: OsmNode[] = [
		{ id: 1, lat: 0, lon: 0, tags: { amenity: "cafe" } },
		{ id: 2, lat: 1, lon: 1 },
	]
	const nodeMap = new Map(nodes.map((n) => [n.id, n]))
	const refToPosition = (id: number) => {
		const node = nodeMap.get(id)
		if (!node) throw new Error(`Node ${id} not found`)
		return [node.lon, node.lat] as [number, number]
	}

	it("filters tagged node features", () => {
		const features = nodesToFeatures(nodes)
		expect(features).toHaveLength(1)
		expect(features[0]).toEqual(nodeToFeature(nodes[0]))
	})

	it("creates polygon features for closed ways", () => {
		const way: OsmWay = {
			id: 10,
			refs: [1, 2, 1],
			tags: { area: "yes" },
		}
		const features = waysToFeatures([way], refToPosition)
		expect(features).toHaveLength(1)
		expect(features[0].geometry?.type).toBe("Polygon")
	})

	it("returns editable collection with way and nodes", () => {
		const way: OsmWay = {
			id: 11,
			refs: [1, 2, 1],
			tags: { highway: "service" },
		}
		const collection = wayToEditableGeoJson(way, (id) => {
			const node = nodeMap.get(id)
			if (!node) throw new Error("Missing node")
			return node
		})
		expect(collection.features).toHaveLength(4)
		expect(collection.features[0]).toEqual(wayToFeature(way, refToPosition))
	})

	it("throws when editable way node missing", () => {
		const way: OsmWay = { id: 12, refs: [1, 3], tags: {} }
		expect(() => wayToEditableGeoJson(way, () => undefined as never)).toThrow()
	})

	it("builds relation geometry collection", () => {
		const relation: OsmRelation = {
			id: 20,
			members: [
				{ type: "node", ref: 1 },
				{ type: "node", ref: 2 },
				{ type: "node", ref: 1 },
			],
			tags: { type: "multipolygon" },
		}
		const feature = relationToFeature(relation, refToPosition)
		expect(feature.geometry.type).toBe("GeometryCollection")
		const polygon = feature.geometry.geometries[0]
		expect(polygon.type).toBe("Polygon")
		expect(polygon.coordinates[0]).toHaveLength(3)
	})
})
