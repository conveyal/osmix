import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"
import { assert, beforeAll, bench, describe } from "vitest"
import {
	OsmPbfBytesToBlocksTransformStream,
	readOsmPbf,
} from "../src/pbf-to-blocks"
import { createOsmEntityCounter, testOsmPbfReader } from "./utils"

describe.each(Object.entries(PBFs))("%s", (_name, pbf) => {
	beforeAll(() => getFixtureFile(pbf.url))

	bench("parse with generators", async () => {
		const file = await getFixtureFile(pbf.url)
		const osm = await readOsmPbf(file)

		await testOsmPbfReader(osm, pbf)
	})

	bench("parse streaming", async () => {
		const { onGroup, count } = createOsmEntityCounter()

		await getFixtureFileReadStream(pbf.url)
			.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
			.pipeTo(
				new WritableStream({
					write: (block) => {
						if ("primitivegroup" in block) {
							for (const group of block.primitivegroup) onGroup(group)
						}
					},
				}),
			)

		assert.equal(count.nodes, pbf.nodes)
		assert.equal(count.ways, pbf.ways)
		assert.equal(count.relations, pbf.relations)
	})
})
