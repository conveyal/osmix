import { beforeAll, describe, expect, it } from "bun:test"
import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"
import { fromPbf, toPbfStream } from "../src/pbf"

describe("write", () => {
	describe.each(Object.entries(PBFs))("%s", async (name, pbf) => {
		beforeAll(() => getFixtureFile(pbf.url))

		it("write osm primitive blocks", async () => {
			// Parse the original PBF
			const fileStream = getFixtureFileReadStream(pbf.url)
			const osm = await fromPbf(fileStream)

			// Get the first node, way, and relation
			const node1 = osm.nodes.getByIndex(0)
			const way1 = osm.ways.getByIndex(0)
			const relation1 = osm.relations.getByIndex(0)
			expect(node1).toBeDefined()
			expect(way1).toBeDefined()
			expect(relation1).toBeDefined()

			const transformStream = new TransformStream<
				Uint8Array<ArrayBufferLike>,
				Uint8Array<ArrayBufferLike>
			>()
			const testOsmPromise = fromPbf(transformStream.readable, {
				id: `${name}-reparsed`,
			})

			// Write the PBF to an array buffer
			// let data = new Uint8Array(0)
			await toPbfStream(osm).pipeTo(transformStream.writable)

			// Re-parse the new PBF
			// expect(data.buffer).toBeDefined()
			const testOsm = await testOsmPromise

			// Compare the original parsed PBF and newly parsed/written/re-parsed PBF
			expect(osm.nodes.size).toBe(testOsm.nodes.size)
			expect(osm.ways.size).toBe(testOsm.ways.size)
			expect(osm.relations.size).toBe(testOsm.relations.size)

			if (node1) {
				const testNode1 = testOsm.nodes.getById(node1.id)
				expect(testNode1).toEqual(node1)
				expect(testNode1?.id).toBe(node1.id)
				expect(testNode1?.lon).toBe(node1.lon)
				expect(testNode1?.lat).toBe(node1.lat)
				expect(testNode1?.tags).toEqual(node1.tags)
			}
			if (way1) {
				const testWay1 = testOsm.ways.getById(way1.id)
				expect(testWay1?.id).toBe(way1.id)
				expect(testWay1?.refs).toEqual(way1.refs)
				expect(testWay1?.tags).toEqual(way1.tags)
			}
			if (relation1) {
				const testRelation1 = testOsm.relations.getById(relation1.id)
				expect(testRelation1?.id).toBe(relation1.id)
				expect(testRelation1?.members).toEqual(relation1.members)
				expect(testRelation1?.tags).toEqual(relation1.tags)
			}
		})
	})
})
