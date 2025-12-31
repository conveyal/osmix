import { getFixtureFile, PBFs } from "@osmix/shared/test/fixtures"
import type { GeoBbox2D } from "@osmix/shared/types"
import { bench, group, run } from "mitata"

import { createExtract } from "../src/extract"
import { fromPbf } from "../src/pbf"

const MONACO_BBOX: GeoBbox2D = [7.4053929, 43.7232244, 7.4447259, 43.7543687]
// const SEATTLE_BBOX: GeoBbox2D = [-122.33, 47.48, -122.29, 47.52]

const BBOX = MONACO_BBOX

/**
 * Extract benchmarks (mitata).
 *
 * Run with: `bun --filter osmix bench`
 */

const monaco = PBFs["monaco"]
if (!monaco) throw Error("Missing Monaco fixture metadata")

console.log("Loading fixture bytes...")
const buffer = await getFixtureFile(monaco.url)
console.log("Fixture loaded. Running benchmarks...\n")

group("extract (monaco)", () => {
	const noopProgress = () => {}

	bench("two-step parse then extract", async () => {
		const data = buffer.slice(0)
		const full = await fromPbf(data, {}, noopProgress)
		createExtract(full, BBOX, "simple")
	})

	bench("streaming extract during parse", async () => {
		const data = buffer.slice(0)
		await fromPbf(data, { extractBbox: BBOX }, noopProgress)
	})
})

await run({ colors: true })
