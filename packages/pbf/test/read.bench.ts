import {
	PBFs,
	getFixtureFile,
	getFixtureFileReadStream,
} from "@osmix/test-utils/fixtures"
import { assert, beforeAll, bench, describe } from "vitest"

import { createOsmPbfReader } from "../src/pbf-to-blocks"
import { createOsmEntityCounter, testReader } from "./utils"
import { OsmPbfBytesToBlocksTransformStream } from "../src/streaming"

describe.each(Object.entries(PBFs))("%s", (_name, pbf) => {
	beforeAll(() => getFixtureFile(pbf.url))

	bench("parse with generators", async () => {
		const file = await getFixtureFile(pbf.url)
		const osm = await createOsmPbfReader(file)

		await testReader(osm, pbf)
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
