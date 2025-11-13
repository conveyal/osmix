import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"
import { assert, beforeAll, describe, it } from "vitest"
import { Osmix } from "../src/osmix"
import { osmixFromPbf, osmixToPbfStream } from "../src/pbf"

describe("write", () => {
	describe.each(Object.entries(PBFs))("%s", async (name, pbf) => {
		beforeAll(() => getFixtureFile(pbf.url))

		it("write osm primitive blocks", async () => {
			// Parse the original PBF
			const fileStream = getFixtureFileReadStream(pbf.url)
			const osm = new Osmix({ id: name })
			await osmixFromPbf(osm, fileStream)

			// Get the first node, way, and relation
			const node1 = osm.nodes.getByIndex(0)
			const way1 = osm.ways.getByIndex(0)
			const relation1 = osm.relations.getByIndex(0)
			assert.exists(node1)
			assert.exists(way1)
			assert.exists(relation1)

			const transformStream = new TransformStream<
				Uint8Array<ArrayBufferLike>,
				Uint8Array<ArrayBufferLike>
			>()
			const testOsm = new Osmix({ id: `${name}-reparsed` })
			const testOsmPromise = osmixFromPbf(testOsm, transformStream.readable)

			// Write the PBF to an array buffer
			// let data = new Uint8Array(0)
			await osmixToPbfStream(osm).pipeTo(transformStream.writable)

			// Re-parse the new PBF
			// assert.exists(data.buffer)
			await testOsmPromise

			// Compare the original parsed PBF and newly parsed/written/re-parsed PBF
			assert.equal(osm.nodes.size, testOsm.nodes.size)
			assert.equal(osm.ways.size, testOsm.ways.size)
			assert.equal(osm.relations.size, testOsm.relations.size)

			if (node1) {
				const testNode1 = testOsm.nodes.getById(node1.id)
				assert.deepEqual(testNode1, node1)
				assert.equal(testNode1?.id, node1.id)
				assert.equal(testNode1?.lon, node1.lon)
				assert.equal(testNode1?.lat, node1.lat)
				assert.deepEqual(testNode1?.tags, node1.tags)
			}
			if (way1) {
				const testWay1 = testOsm.ways.getById(way1.id)
				assert.equal(testWay1?.id, way1.id)
				assert.deepEqual(testWay1?.refs, way1.refs)
				assert.deepEqual(testWay1?.tags, way1.tags)
			}
			if (relation1) {
				const testRelation1 = testOsm.relations.getById(relation1.id)
				assert.equal(testRelation1?.id, relation1.id)
				assert.deepEqual(testRelation1?.members, relation1.members)
				assert.deepEqual(testRelation1?.tags, relation1.tags)
			}
		})
	})
})
