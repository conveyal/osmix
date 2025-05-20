import { assert, test } from "vitest"

import { readOsmPbf } from "../src"
import { osmToPrimitiveBlocks, writePbfToStream } from "../src/write-osm-pbf"
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
			const originalOsmPbf = await readOsmPbf(fileStream, {
				withTags: true,
				withInfo: true,
			})
			// const originalBlocks = await Array.fromAsync(originalPbfReadStream.blocks)

			console.time(`full stream write ${name}`)
			const writeStream = await getFileWriteStream(testFileName)
			await writePbfToStream(
				writeStream,
				originalOsmPbf.header,
				osmToPrimitiveBlocks(originalOsmPbf),
			)
			console.timeEnd(`full stream write ${name}`)

			const testDataStream = await getFileReadStream(testFileName)
			const testOsmPbf = await readOsmPbf(testDataStream)
			// const testBlocks = await Array.fromAsync(testOsmPbf.blocks)

			assert.deepEqual(originalOsmPbf.header, testOsmPbf.header)
			assert.equal(originalOsmPbf.nodes.size, testOsmPbf.nodes.size)
			assert.equal(originalOsmPbf.ways.length, testOsmPbf.ways.length)
			assert.equal(originalOsmPbf.relations.length, testOsmPbf.relations.length)
		},
	)
}
