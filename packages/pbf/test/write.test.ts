import { assert, describe, it } from "vitest"
import { unlink } from "node:fs/promises"

import {
	PBFs,
	getFixtureFile,
	getFixtureFileReadStream,
	getFixtureFileWriteStream,
	getFixturePath,
} from "@osmix/test-utils/fixtures"
import { createOsmPbfReader } from "../src/pbf-to-blocks"
import { createOsmDataBlob, createOsmHeaderBlob } from "../src/blocks-to-pbf"
import { testReader } from "./utils"
import {
	OsmBlocksToPbfBytesTransformStream,
	OsmPbfBytesToBlocksTransformStream,
} from "../src/streaming"

describe("write", () => {
	describe.each(Object.entries(PBFs))("%s", (name, pbf) => {
		it("to buffer", async () => {
			const fileData = await getFixtureFile(pbf.url)
			const osm = await createOsmPbfReader(fileData)

			let node0: number | null = null
			let way0: number | null = null
			let relation0: number | null = null

			// Write the PBF to an array buffer
			let data = new Uint8Array(0)
			const write = (chunk: Uint8Array) => {
				const newData = new Uint8Array(data.length + chunk.length)
				newData.set(data)
				newData.set(chunk, data.length)
				data = newData
			}

			write(await createOsmHeaderBlob(osm.header))
			for await (const block of osm.blocks) {
				for (const group of block.primitivegroup) {
					if (node0 == null && group.dense != null) {
						node0 = group.dense.id[0]
					}
					if (way0 == null && group.ways.length > 0) {
						way0 = group.ways[0].id
					}
					if (relation0 == null && group.relations.length > 0) {
						relation0 = group.relations[0].id
					}
				}
				write(await createOsmDataBlob(block))
			}

			// Re-parse the new PBF and test
			assert.exists(data.buffer)
			// TODO: assert.equal(stream.buffer.byteLength, fileData.byteLength)
			const osm2 = await createOsmPbfReader(data)

			assert.deepEqual(osm.header, osm2.header)
			const entities = await testReader(osm2, pbf)
			assert.equal(entities.node0, node0)
			assert.equal(entities.way0, way0)
			assert.equal(entities.relation0, relation0)
		})

		it("to file", async () => {
			const testFileName = `${name}-write-test.pbf`
			const fileStream = getFixtureFileReadStream(pbf.url)

			await fileStream
				.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
				.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
				.pipeTo(getFixtureFileWriteStream(testFileName))

			const testStream = getFixtureFileReadStream(pbf.url)
			const testOsm = await createOsmPbfReader(testStream)

			assert.deepEqual(testOsm.header.bbox, pbf.bbox)
			await testReader(testOsm, pbf)

			await unlink(getFixturePath(testFileName))
		})
	})
})
