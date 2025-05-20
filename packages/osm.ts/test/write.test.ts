import { assert, test } from "vitest"

import { createOsmPbfReadStream } from "../src/create-osm-pbf-read-stream"

import { writePbfToStream } from "../src/write"
import { PBFs } from "./files"
import { getFileReadStream, getFileWriteStream } from "./utils"

for (const [name, pbf] of Object.entries(PBFs)) {
	test.only(
		`write osm primitive blocks ${name}`,
		{
			timeout: 100_000,
		},
		async () => {
			const testFileName = `${name}.test.pbf`
			const fileStream = await getFileReadStream(pbf.url)
			const originalPbfReadStream = await createOsmPbfReadStream(fileStream)
			const originalBlocks = await Array.fromAsync(originalPbfReadStream.blocks)

			console.time(`full stream write ${name}`)
			const writeStream = await getFileWriteStream(testFileName)
			await writePbfToStream(
				writeStream,
				originalPbfReadStream.header,
				originalBlocks,
			)
			console.timeEnd(`full stream write ${name}`)

			console.log("re-reading")
			const testDataStream = await getFileReadStream(testFileName)
			const testPbfReadStream = await createOsmPbfReadStream(testDataStream)
			const testBlocks = await Array.fromAsync(testPbfReadStream.blocks)

			assert.deepEqual(originalPbfReadStream.header, testPbfReadStream.header)
			assert.equal(originalBlocks.length, testBlocks.length)
		},
	)
}
