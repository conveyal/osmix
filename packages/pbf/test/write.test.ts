import { unlink } from "node:fs/promises"
import {
	getFixtureFile,
	getFixtureFileReadStream,
	getFixtureFileWriteStream,
	getFixturePath,
	PBFs,
} from "@osmix/shared/test/fixtures"
import { assert, describe, it } from "vitest"
import {
	OsmBlocksToPbfBytesTransformStream,
	osmBlockToPbfBlobBytes,
} from "../src/blocks-to-pbf"
import {
	OsmPbfBytesToBlocksTransformStream,
	readOsmPbf,
} from "../src/pbf-to-blocks"
import { testOsmPbfReader } from "./utils"

describe("write", () => {
	describe.each(Object.entries(PBFs))("%s", (name, pbf) => {
		it("to buffer", async () => {
			const fileData = await getFixtureFile(pbf.url)
			const osm = await readOsmPbf(fileData)

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

			write(await osmBlockToPbfBlobBytes(osm.header))
			for await (const block of osm.blocks) {
				for (const group of block.primitivegroup) {
					if (node0 == null && group.dense?.id?.[0] != null) {
						node0 = group.dense.id[0]
					}
					if (way0 == null && group.ways?.[0]?.id != null) {
						way0 = group.ways[0].id
					}
					if (relation0 == null && group.relations?.[0]?.id != null) {
						relation0 = group.relations[0].id
					}
				}
				write(await osmBlockToPbfBlobBytes(block))
			}

			// Re-parse the new PBF and test
			assert.exists(data.buffer)
			// TODO: assert.equal(stream.buffer.byteLength, fileData.byteLength)
			const osm2 = await readOsmPbf(data.buffer)

			assert.deepEqual(osm.header, osm2.header)
			const entities = await testOsmPbfReader(osm2, pbf)
			assert.equal(entities.node0, node0)
			assert.equal(entities.way0, way0)
			assert.equal(entities.relation0, relation0)
		})

		it("to file", async () => {
			const testFileName = `${name}-write-test.pbf`
			const fileStream = getFixtureFileReadStream(pbf.url)

			const fileWriteStream = getFixtureFileWriteStream(testFileName)
			await fileStream
				.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
				.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
				.pipeTo(fileWriteStream)

			const testFileData = await getFixtureFile(pbf.url)
			const testOsm = await readOsmPbf(testFileData)

			assert.deepEqual(testOsm.header.bbox, pbf.bbox)
			await testOsmPbfReader(testOsm, pbf)

			await unlink(getFixturePath(testFileName))
		})
	})
})
