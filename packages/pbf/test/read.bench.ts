import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"
import { bench, group, run } from "mitata"
import {
	OsmPbfBytesToBlocksTransformStream,
	readOsmPbf,
} from "../src/pbf-to-blocks"
import { readOsmPbfParallel } from "../src/pbf-to-blocks-parallel"
import { createOsmEntityCounter, testOsmPbfReader } from "./utils"

/**
 * OSM PBF parsing benchmarks (mitata).
 *
 * Run with: `bun --filter @osmix/pbf bench`
 */

const monaco = PBFs["monaco"]
if (!monaco) throw Error("Missing Monaco fixture metadata")

console.log("Loading fixture bytes...")
const buffer = await getFixtureFile(monaco.url)
console.log("Fixture loaded. Running benchmarks...\n")

// Sanity check once (fail fast if parsing regressed)
{
	const single = await readOsmPbf(buffer.slice(0))
	await testOsmPbfReader(single, monaco)
	const parallel = await readOsmPbfParallel(buffer.slice(0), { workers: 2 })
	await testOsmPbfReader(parallel, monaco)
}

group("readOsmPbf (monaco)", () => {
	bench("generators (single-thread)", async () => {
		const osm = await readOsmPbf(buffer.slice(0))
		await testOsmPbfReader(osm, monaco)
	})

	bench("generators (parallel decode, workers=2)", async () => {
		const osm = await readOsmPbfParallel(buffer.slice(0), { workers: 2 })
		await testOsmPbfReader(osm, monaco)
	})

	bench("generators (parallel decode, workers=4)", async () => {
		const osm = await readOsmPbfParallel(buffer.slice(0), { workers: 4 })
		await testOsmPbfReader(osm, monaco)
	})

	bench("streaming TransformStream (single-thread)", async () => {
		const { onGroup, count } = createOsmEntityCounter()
		await getFixtureFileReadStream(monaco.url)
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

		if (
			count.nodes !== monaco.nodes ||
			count.ways !== monaco.ways ||
			count.relations !== monaco.relations
		) {
			throw Error(
				`Unexpected counts: ${count.nodes}/${count.ways}/${count.relations}`,
			)
		}
	})
})

await run({ colors: true })
