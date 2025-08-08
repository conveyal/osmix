import assert from "node:assert"
import { describe, it } from "vitest"
import * as turf from "@turf/turf"

import { PBFs } from "./files"
import { getFileReadStream } from "./utils"
import { nodesToFeatures, waysToFeatures } from "../src/to-geojson"
import { Osm } from "../src/osm"

describe("geojson", () => {
	describe.each(Object.entries(PBFs))(
		"%s",
		{ timeout: 100_000 },
		async (_, pbf) => {
			it.runIf(pbf.nodes <= 1_000_000)("generate from pbf", async () => {
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await Osm.fromPbfData(fileStream)
				assert.deepEqual(osm.header.bbox, pbf.bbox)

				const nodes = nodesToFeatures(osm.nodes)
				const ways = waysToFeatures(osm.ways, osm.nodes, () => true)

				// Check that all features are valid GeoJSON and have unique IDs
				const seenIds = new Set()
				for (const feature of nodes) {
					turf.featureOf(feature, "Point", "test")
					assert.equal(feature.type, "Feature")
					assert.ok(feature.id !== undefined && feature.id !== null)
					assert.ok(
						!seenIds.has(feature.id),
						`Duplicate feature id: ${feature.id}`,
					)
					seenIds.add(feature.id)
					assert.ok(feature.geometry)
					assert.ok(feature.geometry.type === "Point")
					assert.ok(
						Array.isArray(feature.geometry.coordinates) &&
							feature.geometry.coordinates.length === 2,
					)
				}
				for (const feature of ways) {
					assert.equal(feature.type, "Feature")
					assert.ok(feature.id !== undefined && feature.id !== null)
					assert.ok(
						!seenIds.has(feature.id),
						`Duplicate feature id: ${feature.id}`,
					)
					seenIds.add(feature.id)
					assert.ok(["LineString", "Polygon"].includes(turf.getType(feature)))
					const coords = turf.getCoords(feature)
					assert.ok(Array.isArray(coords))
					assert.ok(coords.length > 0)
					turf.coordEach(feature, (c) => {
						assert.ok(Array.isArray(c))
						assert.ok(c.length === 2)
					})
				}

				assert.equal(pbf.geoJsonFeatures, nodes.length + ways.length)
			})
		},
	)
})
