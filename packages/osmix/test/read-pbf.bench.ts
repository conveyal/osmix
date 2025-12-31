import { getFixtureFile, PBFs } from "@osmix/shared/test/fixtures"
import { bench, group, run } from "mitata"
import { fromPbf } from "../src/pbf"

/**
 * Osmix ingestion benchmarks (mitata).
 *
 * Run with: `bun --filter osmix bench`
 */

const monaco = PBFs["monaco"]
if (!monaco) throw Error("Missing Monaco fixture metadata")

console.log("Loading fixture bytes...")
const buffer = await getFixtureFile(monaco.url)
console.log("Fixture loaded. Running benchmarks...\n")

const noopProgress = () => {}

group("fromPbf (monaco, no spatial indexes)", () => {
	bench("parseConcurrency=1", async () => {
		const data = buffer.slice(0)
		await fromPbf(
			data,
			{
				id: "bench-single",
				parseConcurrency: 1,
				// Keep benchmark focused on parsing + indexes (not spatial indexes).
				buildSpatialIndexes: [],
			},
			noopProgress,
		)
	})

	bench("parseConcurrency=2", async () => {
		const data = buffer.slice(0)
		await fromPbf(
			data,
			{
				id: "bench-par-2",
				parseConcurrency: 2,
				buildSpatialIndexes: [],
			},
			noopProgress,
		)
	})

	bench("parseConcurrency=4", async () => {
		const data = buffer.slice(0)
		await fromPbf(
			data,
			{
				id: "bench-par-4",
				parseConcurrency: 4,
				buildSpatialIndexes: [],
			},
			noopProgress,
		)
	})
})

await run({ colors: true })
