import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures"
import { featureOf, getCoords, getType } from "@turf/invariant"
import { coordEach } from "@turf/meta"
import { assert, describe, it } from "vitest"
import { createOsmIndexFromPbfData } from "../src"
import { nodeToFeature, wayToFeature } from "../src/to-geojson"

describe("geojson", () => {
	describe.each(Object.entries(PBFs))("%s", async (_, pbf) => {
		it("generate from pbf", async () => {
			const file = getFixtureFileReadStream(pbf.url)
			const osm = await createOsmIndexFromPbfData(file)
			assert.deepEqual(osm.header.bbox, pbf.bbox)

			// Check that all features are valid GeoJSON and have unique IDs
			const seenNodeIds = new Set()
			let nodeFeatures = 0
			for (const node of osm.nodes) {
				if (!node.tags || Object.keys(node.tags).length === 0) continue
				const feature = nodeToFeature(node)
				featureOf(feature, "Point", "test")
				assert.equal(feature.type, "Feature")
				assert.ok(feature.id !== undefined && feature.id !== null)
				assert.ok(
					!seenNodeIds.has(feature.id),
					`Duplicate feature id: ${feature.id}`,
				)
				seenNodeIds.add(feature.id)
				assert.ok(feature.geometry)
				assert.ok(feature.geometry.type === "Point")
				assert.ok(
					Array.isArray(feature.geometry.coordinates) &&
						feature.geometry.coordinates.length === 2,
				)
				nodeFeatures++
			}

			const seenWayIds = new Set()
			let wayFeatures = 0
			for (const way of osm.ways) {
				const feature = wayToFeature(way, osm.nodes)
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

			assert.equal(wayFeatures, pbf.ways)
			assert.equal(nodeFeatures, pbf.nodesWithTags)
		})
	})
})
