import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/test-utils/fixtures"
import { assert, beforeAll, describe, it } from "vitest"
import { createOsmPbfReader } from "../src/pbf-to-blocks"
import { OsmPbfBytesToBlocksTransformStream } from "../src/streaming"
import { createOsmEntityCounter, testReader } from "./utils"

describe("read", () => {
	describe.each(Object.entries(PBFs))("%s", async (_name, pbf) => {
		beforeAll(() => getFixtureFile(pbf.url))

		it("from stream", async () => {
			const { onGroup, count } = createOsmEntityCounter()

			await getFixtureFileReadStream(pbf.url)
				.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
				.pipeTo(
					new WritableStream({
						write: (block) => {
							if ("primitivegroup" in block) {
								for (const group of block.primitivegroup) onGroup(group)
							} else {
								assert.deepEqual(block.bbox, pbf.bbox)
							}
						},
					}),
				)

			assert.equal(count.nodes, pbf.nodes)
			assert.equal(count.ways, pbf.ways)
			assert.equal(count.relations, pbf.relations)
		})

		it("from buffer", async () => {
			const fileData = await getFixtureFile(pbf.url)
			const osm = await createOsmPbfReader(fileData)
			await testReader(osm, pbf)
		})
	})
})
