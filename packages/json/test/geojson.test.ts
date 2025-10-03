import { toAsyncGenerator } from "@osmix/pbf"
import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures"
import { featureOf, getCoords, getType } from "@turf/invariant"
import { coordEach } from "@turf/meta"
import { assert, describe, it } from "vitest"
import { isNode, isWay } from "../src"
import { nodeToFeature, wayToFeature } from "../src/geojson"
import { osmPbfToJson } from "../src/pbf-to-json"
import type { OsmEntity, OsmNode } from "../src/types"

describe("geojson", () => {
	describe.each(Object.entries(PBFs))("%s", async (_, pbf) => {
		it("generate from pbf", async () => {
			const file = getFixtureFileReadStream(pbf.url)
			const osmGenerator = toAsyncGenerator(osmPbfToJson(file))
			const header = (await osmGenerator.next()).value
			assert.deepEqual(header.bbox, pbf.bbox)

			const entities = await Array.fromAsync(
				osmGenerator as AsyncGenerator<OsmEntity>,
			)

			// Check that all features are valid GeoJSON and have unique IDs
			const nodeMap = new Map<number, OsmNode>()
			let nodeFeatures = 0
			const seenWayIds = new Set()
			let wayFeatures = 0
			for (const entity of entities) {
				if (isNode(entity)) {
					const node = entity
					nodeMap.set(node.id, node)
					if (!node.tags || Object.keys(node.tags).length === 0) continue
					const feature = nodeToFeature(node)
					featureOf(feature, "Point", "test")
					assert.equal(feature.type, "Feature")
					assert.ok(feature.id !== undefined && feature.id !== null)
					assert.ok(feature.geometry)
					assert.ok(feature.geometry.type === "Point")
					assert.ok(
						Array.isArray(feature.geometry.coordinates) &&
							feature.geometry.coordinates.length === 2,
					)
					nodeFeatures++
				} else if (isWay(entity)) {
					const way = entity
					const feature = wayToFeature(way, (id) => {
						const node = nodeMap.get(id)
						if (!node) {
							console.error(`Node ${id} not found`)
							return [0, 0]
						}
						return [node.lon, node.lat]
					})

					assert.equal(feature.type, "Feature")
					assert.ok(feature.id !== undefined && feature.id !== null)
					assert.ok(
						!seenWayIds.has(feature.id),
						`Duplicate feature id: ${feature.id}`,
					)
					seenWayIds.add(feature.id)
					assert.ok(["LineString", "Polygon"].includes(getType(feature)))
					const coords = getCoords(feature)
					assert.ok(Array.isArray(coords))
					assert.ok(coords.length > 0)
					coordEach(feature, (c) => {
						assert.ok(Array.isArray(c))
						assert.ok(c.length === 2)
					})
					wayFeatures++
				}
			}

			assert.equal(wayFeatures, pbf.ways)
			assert.equal(nodeFeatures, pbf.nodesWithTags)
		})
	})
})
