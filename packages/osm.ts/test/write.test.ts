import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/test-utils/fixtures"
import { assert, beforeAll, describe, it } from "vitest"
import { createOsmIndexFromPbfData } from "../src/osm-from-pbf"
import { writeOsmToPbfStream } from "../src/osm-to-pbf"

describe("write", () => {
	describe.each(Object.entries(PBFs))("%s", async (name, pbf) => {
		beforeAll(() => getFixtureFile(pbf.url))

		it("write osm primitive blocks", async () => {
			// Parse the original PBF
			const fileStream = getFixtureFileReadStream(pbf.url)
			const osm = await createOsmIndexFromPbfData(fileStream, name)

			// Get the first node, way, and relation
			const node1 = osm.nodes.getByIndex(0)
			const way1 = osm.ways.getByIndex(0)
			const relation1 = osm.relations.getByIndex(0)
			assert.exists(node1)
			assert.exists(way1)
			assert.exists(relation1)

			// Write the PBF to an array buffer
			let data = new Uint8Array(0)
			await writeOsmToPbfStream(
				osm,
				new WritableStream({
					write: (chunk) => {
						const newData = new Uint8Array(data.length + chunk.length)
						newData.set(data)
						newData.set(chunk, data.length)
						data = newData
					},
				}),
			)

			// Re-parse the new PBF
			assert.exists(data.buffer)
			const testOsm = await createOsmIndexFromPbfData(data, `${name}-reparsed`)

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
	})
})
