import assert from "node:assert"
import { test } from "vitest"

import { createOsmPbfReadStream } from "../src/create-osm-pbf-read-stream"
import { readOsmPbfPrimitiveBlocks } from "../src/read-osm-pbf-blocks"

import { PBFs } from "./files"
import { getFileReadStream } from "./utils"

for (const [name, pbf] of Object.entries(PBFs)) {
	test(
		`parse osm pbf ${name}`,
		{
			timeout: 100_000,
		},
		async () => {
			const fileStream = await getFileReadStream(pbf.url)
			const pbfStream = await createOsmPbfReadStream(fileStream)
			assert.deepEqual(pbfStream.header.bbox, pbf.bbox)

			let nodes = 0
			let ways = 0
			let relations = 0
			for await (const entity of readOsmPbfPrimitiveBlocks(pbfStream.blocks, {
				withTags: false,
				withInfo: false,
			})) {
				if ("members" in entity) {
					relations++
				} else if ("refs" in entity) {
					ways++
				} else {
					nodes++
				}
			}

			console.log(`Total chunks: ${pbfStream.stats.chunks}`)
			console.log(`Total blocks parsed: ${pbfStream.stats.blocks}`)
			console.log(
				`Total inflate time: ${(pbfStream.stats.inflateMs / 1000).toFixed(2)}s`,
			)
			console.log(
				`Data size: ${(pbfStream.stats.inflateBytes / 1024 / 1024).toFixed(2)}MB`,
			)

			assert.equal(nodes, pbf.nodes)
			assert.equal(ways, pbf.ways)
			assert.equal(relations, pbf.relations)
		},
	)
}
