import assert from "node:assert"
import { describe, it } from "vitest"

import { PBFs } from "./files"
import { getFileReadStream } from "./utils"
import { entitiesToGeoJSON } from "../src/to-geojson"
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

				const features: GeoJSON.Feature[] = entitiesToGeoJSON(osm)

				assert.equal(features.length, pbf.geoJsonFeatures)
			})
		},
	)
})
