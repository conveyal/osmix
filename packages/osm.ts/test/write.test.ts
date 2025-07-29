import { assert, describe, it } from "vitest"

import { Osm } from "../src"
import { writePbfToStream } from "../src/pbf/osm-pbf-writer"
import { PBFs } from "./files"
import { getFileReadStream, getFileWriteStream } from "./utils"

describe("write", () => {
	describe.each(Object.entries(PBFs))(
		"%s",
		{ timeout: 100_000 },
		async (name, pbf) => {
			it.runIf(pbf.nodes <= 1_000_000)(
				"write osm primitive blocks",
				async () => {
					// Parse the original PBF
					const fileStream = await getFileReadStream(pbf.url)
					const osm = await Osm.fromPbfData(fileStream)

					// Get the first node, way, and relation
					const node1 = osm.nodes.get(osm.nodes.idByIndex[0])
					const way1 = osm.ways.values().next().value
					const relation1 = osm.relations.values().next().value

					// Write the PBF to a new file
					const testFileName = `${name}.test.pbf`
					const writeStream = await getFileWriteStream(testFileName)
					await writePbfToStream(
						writeStream,
						osm.header,
						osm.generatePbfPrimitiveBlocks(),
					)

					// Re-parse the new PBF
					const testDataStream = await getFileReadStream(testFileName)
					const testOsm = await Osm.fromPbfData(testDataStream)

					// Compare the original parsed PBF and newly parsed/written/re-parsed PBF
					assert.deepEqual(osm.header, testOsm.header)
					assert.equal(osm.nodes.size, testOsm.nodes.size)
					assert.equal(osm.ways.size, testOsm.ways.size)
					assert.equal(osm.relations.size, testOsm.relations.size)

					if (node1) {
						const testNode1 = testOsm.nodes.get(node1.id)
						assert.deepEqual(node1, testNode1)
						assert.equal(node1.id, testNode1?.id)
						assert.equal(node1.lon, testNode1?.lon)
						assert.equal(node1.lat, testNode1?.lat)
						assert.deepEqual(node1.tags, testNode1?.tags)
					}
					if (way1) {
						const testWay1 = testOsm.ways.get(way1.id)
						assert.equal(way1.id, testWay1?.id)
						assert.deepEqual(way1.refs, testWay1?.refs)
						assert.deepEqual(way1.tags, testWay1?.tags)
					}
					if (relation1) {
						const testRelation1 = testOsm.relations.get(relation1.id)
						assert.equal(relation1.id, testRelation1?.id)
						assert.deepEqual(relation1.members, testRelation1?.members)
						assert.deepEqual(relation1.tags, testRelation1?.tags)
					}
				},
			)
		},
	)
})
