import assert from "node:assert"
import { test } from "vitest"

import { createOsmPbfStream } from "../lib/create-osm-pbf-stream"
import { readOsmPbfPrimitiveBlocks } from "../lib/read-osm-pbf-blocks"

import type { OsmNode, OsmRelation, OsmWay } from "../lib/types"
import { PBFs } from "./files"
import { getFileStream } from "./utils"

for (const [name, pbf] of Object.entries(PBFs)) {
	test(
		`parse osm pbf ${name}`,
		{
			timeout: 100_000,
		},
		async () => {
			const fileStream = await getFileStream(pbf.url)
			console.time(`full stream parse ${name}`)
			console.time(`parse header ${name}`)
			const pbfStream = await createOsmPbfStream(fileStream)
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
