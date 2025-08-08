import assert from "node:assert"
import { describe, it } from "vitest"

import { Osm } from "../src/osm"
import { createOsmPbfReader } from "../src/pbf/osm-pbf-reader"
import { PBFs } from "./files"
import { getFile, getFileReadStream } from "./utils"
import { PrimitiveBlockParser } from "../src/pbf/primitive-block-parser"
import { isRelation, isWay, logEvery } from "../src/utils"

describe("read", () => {
	describe.each(Object.entries(PBFs))(
		"%s",
		{ timeout: 300_000 },
		async (name, pbf) => {
			it.runIf(pbf.nodes < 40_000)("from pbf stream", async () => {
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await createOsmPbfReader(fileStream)
				assert.deepEqual(osm.header.bbox, pbf.bbox)

				const log = logEvery(1_000)
				let nodes = 0
				let ways = 0
				let relations = 0
				for await (const block of osm.blocks) {
					const blockParser = new PrimitiveBlockParser(block)
					for await (const entity of blockParser) {
						if (Array.isArray(entity)) {
							nodes += entity.length
						} else if (isRelation(entity)) {
							relations++
						} else if (isWay(entity)) {
							ways++
						}
						log(
							`${nodes.toLocaleString()} nodes, ${ways.toLocaleString()} ways, ${relations.toLocaleString()} relations`,
						)
					}
				}

				assert.equal(nodes, pbf.nodes)
				assert.equal(ways, pbf.ways)
				assert.equal(relations, pbf.relations)
			})

			it.runIf(pbf.nodes <= 40_000)("from pbf buffer", async () => {
				const fileData = await getFile(pbf.url)
				const osm = await createOsmPbfReader(fileData)
				assert.deepEqual(osm.header.bbox, pbf.bbox)

				let nodes = 0
				let ways = 0
				let relations = 0
				for await (const block of osm.blocks) {
					const blockParser = new PrimitiveBlockParser(block)
					for await (const entity of blockParser) {
						if (Array.isArray(entity)) {
							nodes += entity.length
						} else if (isRelation(entity)) {
							relations++
						} else if (isWay(entity)) {
							ways++
						}
					}
				}

				assert.equal(nodes, pbf.nodes)
				assert.equal(ways, pbf.ways)
				assert.equal(relations, pbf.relations)
			})

			it.runIf(pbf.nodes <= 40_000)("into OSM class", async () => {
				const fileData = await getFile(pbf.url)
				const osm = await Osm.fromPbfData(fileData)
				assert.equal(osm.nodes.size, pbf.nodes)
				assert.equal(osm.stringTable.length, pbf.uniqueStrings)
				assert.deepEqual(osm.nodes.getByIndex(0), pbf.node0)
				assert.equal(osm.ways.size, pbf.ways)
			})
		},
	)
})
