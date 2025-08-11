import * as turf from "@turf/turf"
import assert from "node:assert"
import { describe, it } from "vitest"

import { Osm } from "../src/osm"
import { nodeToFeature, wayToFeature } from "../src/to-geojson"
import { PBFs } from "./files"
import { getFileReadStream } from "./utils"

describe("geojson", () => {
	describe.each(Object.entries(PBFs))(
		"%s",
		{ timeout: 100_000 },
		async (_, pbf) => {
			it.runIf(pbf.nodes < 100_000)("generate from pbf", async () => {
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await Osm.fromPbfData(fileStream)
				assert.deepEqual(osm.header.bbox, pbf.bbox)

				// Check that all features are valid GeoJSON and have unique IDs
				const seenNodeIds = new Set()
				let nodeFeatures = 0
				for (const node of osm.nodes) {
					if (!node.tags || Object.keys(node.tags).length === 0) continue
					const feature = nodeToFeature(node)
					turf.featureOf(feature, "Point", "test")
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
					assert.ok(["LineString", "Polygon"].includes(turf.getType(feature)))
					const coords = turf.getCoords(feature)
					assert.ok(Array.isArray(coords))
					assert.ok(coords.length > 0)
					turf.coordEach(feature, (c) => {
						assert.ok(Array.isArray(c))
						assert.ok(c.length === 2)
					})
					wayFeatures++
				}

				assert.equal(wayFeatures, pbf.ways)
				assert.equal(nodeFeatures, pbf.nodesWithTags)
			})
		},
	)
})
