import { assert, describe, it } from "vitest"

import { Osm, createOsmPbfReader } from "../src"
import { osmToPrimitiveBlocks, writePbfToStream } from "../src/write-osm-pbf"
import { PBFs } from "./files"
import { getFileReadStream, getFileWriteStream } from "./utils"

describe("write osm primitive blocks", () => {
	for (const [name, pbf] of Object.entries(PBFs)) {
		it(
			`${name}`,
			{
				timeout: 100_000,
			},
			async () => {
				const testFileName = `${name}.test.pbf`
				const fileStream = await getFileReadStream(pbf.url)
				const osmReader = await createOsmPbfReader(fileStream)
				const osm = await Osm.fromPbfReader(osmReader)

				const writeStream = await getFileWriteStream(testFileName)
				await writePbfToStream(
					writeStream,
					osm.header,
					osmToPrimitiveBlocks(osm),
				)

				const testDataStream = await getFileReadStream(testFileName)
				const testOsmPbf = await createOsmPbfReader(testDataStream)
				const testOsm = await Osm.fromPbfReader(testOsmPbf)

				assert.deepEqual(osm.header, testOsm.header)
				assert.equal(osm.nodes.size, testOsm.nodes.size)
				assert.equal(osm.ways.size, testOsm.ways.size)
				assert.equal(osm.relations.size, testOsm.relations.size)
			},
		)
	}
})
