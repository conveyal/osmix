import { beforeAll, describe, expect } from "bun:test"
import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"

// @ts-expect-error - bench is available at runtime but not in types
const { bench } = globalThis as { bench: typeof import("bun:test").test }

import {
	OsmPbfBytesToBlocksTransformStream,
	readOsmPbf,
} from "../src/pbf-to-blocks"
import { readOsmPbfParallel } from "../src/pbf-to-blocks-parallel"
import { createOsmEntityCounter, testOsmPbfReader } from "./utils"

describe.each(Object.entries(PBFs))("%s", (_name, pbf) => {
	beforeAll(() => getFixtureFile(pbf.url))

	bench("parse with generators", async () => {
		const file = await getFixtureFile(pbf.url)
		const osm = await readOsmPbf(file)

		await testOsmPbfReader(osm, pbf)
	})

	bench("parse with generators (parallel decode)", async () => {
		const file = await getFixtureFile(pbf.url)
		const osm = await readOsmPbfParallel(file, { workers: 2 })

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

		expect(count.nodes).toBe(pbf.nodes)
		expect(count.ways).toBe(pbf.ways)
		expect(count.relations).toBe(pbf.relations)
	})
})
