import { assert, describe, it } from "vitest"

import { Osm } from "../src"
import { PBFs } from "./files"
import {
	getFileReadStream,
	getFileWriteStream,
	WriteableStreamArrayBuffer,
} from "./utils"
import { writeOsmToPbfStream } from "../src/osm-to-pbf"

describe("write", () => {
	describe.each(Object.entries(PBFs))(
		"%s",
		{ timeout: 100_000 },
		async (name, pbf) => {
			it.runIf(pbf.nodes <= 40_000)("write osm primitive blocks", async () => {
				// Parse the original PBF
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await Osm.fromPbfData(fileStream)

				// Get the first node, way, and relation
				const node1 = osm.nodes.getByIndex(0)
				const way1 = osm.ways.getByIndex(0)
				const relation1 = osm.relations.getByIndex(0)
				assert.exists(node1)
				assert.exists(way1)
				assert.exists(relation1)

				// Write the PBF to an array buffer
				const writeStream = new WriteableStreamArrayBuffer()
				await writeOsmToPbfStream(osm, writeStream)

				// Re-parse the new PBF
				assert.exists(writeStream.buffer)
				const testOsm = await Osm.fromPbfData(writeStream.buffer)

				// Compare the original parsed PBF and newly parsed/written/re-parsed PBF
				assert.equal(osm.nodes.size, testOsm.nodes.size)
				assert.equal(osm.ways.size, testOsm.ways.size)
				assert.equal(osm.relations.size, testOsm.relations.size)

				if (node1) {
					const testNode1 = testOsm.nodes.getById(node1.id)
					assert.deepEqual(node1, testNode1)
					assert.equal(node1.id, testNode1?.id)
					assert.equal(node1.lon, testNode1?.lon)
					assert.equal(node1.lat, testNode1?.lat)
					assert.deepEqual(node1.tags, testNode1?.tags)
				}
				if (way1) {
					const testWay1 = testOsm.ways.getById(way1.id)
					assert.equal(way1.id, testWay1?.id)
					assert.deepEqual(way1.refs, testWay1?.refs)
					assert.deepEqual(way1.tags, testWay1?.tags)
				}
				if (relation1) {
					const testRelation1 = testOsm.relations.getById(relation1.id)
					assert.equal(relation1.id, testRelation1?.id)
					assert.deepEqual(relation1.members, testRelation1?.members)
					assert.deepEqual(relation1.tags, testRelation1?.tags)
				}
			})
		},
	)
})
