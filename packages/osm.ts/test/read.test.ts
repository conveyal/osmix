import assert from "node:assert"
import { describe, it } from "vitest"

import { Osm } from "../src/osm"
import { createOsmPbfReader } from "../src/osm-pbf-reader"
import { PBFs } from "./files"
import { getFile, getFileReadStream } from "./utils"

describe("parse osm pbf stream", () => {
	it.each(Object.entries(PBFs))("%s", { timeout: 100_000 }, async (_, pbf) => {
		const fileStream = await getFileReadStream(pbf.url)
		const osm = await createOsmPbfReader(fileStream)
		assert.deepEqual(osm.header.bbox, pbf.bbox)

		let nodes = 0
		let ways = 0
		let relations = 0
		for await (const entity of osm) {
			if (Array.isArray(entity)) {
				nodes += entity.length
			} else if (entity.type === "relation") {
				relations++
			} else if (entity.type === "way") {
				ways++
			}
		}

		assert.equal(nodes, pbf.nodes)
		assert.equal(ways, pbf.ways)
		assert.equal(relations, pbf.relations)
	})
})

describe("parse osm pbf buffer", () => {
	it.each(Object.entries(PBFs))("%s", { timeout: 100_000 }, async (_, pbf) => {
		const fileData = await getFile(pbf.url)
		const osm = await createOsmPbfReader(fileData)
		assert.deepEqual(osm.header.bbox, pbf.bbox)

		let nodes = 0
		let ways = 0
		let relations = 0
		for await (const entity of osm) {
			if (Array.isArray(entity)) {
				nodes += entity.length
			} else if (entity.type === "relation") {
				relations++
			} else if (entity.type === "way") {
				ways++
			}
		}

		assert.equal(nodes, pbf.nodes)
		assert.equal(ways, pbf.ways)
		assert.equal(relations, pbf.relations)
	})

	it("read monaco entities", async () => {
		const pbf = PBFs.monaco
		const fileData = await getFile(pbf.url)
		const osm = await createOsmPbfReader(fileData)
		const entities = await Osm.fromPbfReader(osm)
		assert.equal(entities.nodes.size, pbf.nodes)
		assert.equal(entities.ways.size, pbf.ways)
	})
})
