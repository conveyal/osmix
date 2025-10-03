import {
	OsmBlocksToPbfBytesTransformStream,
	OsmPbfBytesToBlocksTransformStream,
	type OsmPbfHeaderBlock,
	readOsmPbf,
} from "@osmix/pbf"
import { testOsmPbfReader } from "@osmix/pbf/test/utils"
import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures"
import { assert, describe, it } from "vitest"
import { OsmJsonToBlocksTransformStream } from "../src/json-to-pbf"
import { OsmBlocksToJsonTransformStream } from "../src/pbf-to-json"

describe("pbf json", () => {
	describe.each(Object.entries(PBFs))("%s", async (_name, pbf) => {
		it("parse all entities", async () => {
			const file = getFixtureFileReadStream(pbf.url)
			let header: OsmPbfHeaderBlock | undefined
			let entityCount = 0
			await file
				.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
				.pipeThrough(new OsmBlocksToJsonTransformStream())
				.pipeTo(
					new WritableStream({
						write: (entity) => {
							if ("id" in entity) {
								entityCount++
							} else {
								header = entity
							}
						},
					}),
				)

			assert.deepEqual(header?.bbox, pbf.bbox)
			assert.equal(entityCount, pbf.nodes + pbf.ways + pbf.relations)
		})

		it("build from parsed entites", async () => {
			const file = getFixtureFileReadStream(pbf.url)

			// Write the PBF to an array buffer
			let data = new Uint8Array(0)
			await file
				.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
				.pipeThrough(new OsmBlocksToJsonTransformStream()) // Convert PBF blocks to JSON entities
				.pipeThrough(new OsmJsonToBlocksTransformStream()) // And convert right back to PBF blocks
				.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
				.pipeTo(
					new WritableStream({
						write: (buffer) => {
							const chunk = new Uint8Array(buffer)
							const newData = new Uint8Array(data.length + chunk.length)
							newData.set(data)
							newData.set(chunk, data.length)
							data = newData
						},
					}),
				)

			// Re-parse the new PBF and test
			const osm2 = await readOsmPbf(data.buffer)
			await testOsmPbfReader(osm2, pbf)
		})
	})
})
