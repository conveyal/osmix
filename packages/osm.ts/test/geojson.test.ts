import assert from "node:assert"
import { describe, it } from "vitest"

import { createOsmPbfReader } from "../src/osm-pbf-reader"
import { PBFs } from "./files"
import { getFileReadStream } from "./utils"

describe("generate geojson from osm pbf", () => {
	for (const [name, pbf] of Object.entries(PBFs)) {
		it(
			`${name}`,
			{
				timeout: 100_000,
			},
			async () => {
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await createOsmPbfReader(fileStream)
				assert.deepEqual(osm.header.bbox, pbf.bbox)

				let features = 0
				for await (const feature of osm.generateGeoJSON()) {
					features++
				}

				assert.equal(features, pbf.geoJsonFeatures)
			},
		)
	}
})
