import { beforeAll, describe, expect, it } from "bun:test"
import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/fixtures"
import {
	OsmPbfBytesToBlocksTransformStream,
	readOsmPbf,
} from "../src/pbf-to-blocks"
import { createOsmEntityCounter, testOsmPbfReader } from "../src/utils"

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
								expect(block.bbox).toEqual(pbf.bbox)
							}
						},
					}),
				)

			expect(count.nodes).toBe(pbf.nodes)
			expect(count.ways).toBe(pbf.ways)
			expect(count.relations).toBe(pbf.relations)
		})

		it("from buffer", async () => {
			const fileData = await getFixtureFile(pbf.url)
			const osm = await readOsmPbf(fileData)
			await testOsmPbfReader(osm, pbf)
		})
	})
})
