import assert from "node:assert"
import { describe, it } from "vitest"

import { createOsmPbfReader } from "../src/osm-pbf-reader"
import { generateGeoJsonFromOsmPbfReader } from "../src/to-geojson"
import { PBFs } from "./files"
import { getFileReadStream } from "./utils"

describe("generate geojson from osm pbf", () => {
	it.each(Object.entries(PBFs))("%s", { timeout: 100_000 }, async (_, pbf) => {
		const fileStream = await getFileReadStream(pbf.url)
		const osm = await createOsmPbfReader(fileStream)
		assert.deepEqual(osm.header.bbox, pbf.bbox)

		let features = 0
		for await (const feature of generateGeoJsonFromOsmPbfReader(osm)) {
			features++
		}

		assert.equal(features, pbf.geoJsonFeatures)
	})
})
