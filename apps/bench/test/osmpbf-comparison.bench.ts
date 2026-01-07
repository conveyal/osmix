/**
 * Benchmarks comparing Osmix to fast-osmpbf-js
 *
 * Based on the NodeJS examples from fast-osmpbf README:
 * 1. Count ways
 * 2. Count elements with full addresses (addr:city, addr:postcode, addr:street, addr:housenumber)
 *
 * Run with: bun test/osmpbf-comparison.bench.ts
 *
 * Note: fast-osmpbf-js has a bug where it maintains global state and cannot be
 * instantiated multiple times in the same process. We work around this by:
 * - Running Osmix benchmarks with mitata for statistical accuracy
 * - Running fast-osmpbf once at the end for a single comparison data point
 */
/** biome-ignore-all lint/suspicious/noAssignInExpressions: <explanation> */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { OsmPbfBytesToBlocksTransformStream, readOsmPbf } from "@osmix/pbf"
import {
	getTags,
	type JsElementBlock,
	type JsElementFilter,
	OsmReader,
} from "fast-osmpbf-js"
import { bench, group, run } from "mitata"

// Resolve fixture paths
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PBF_NAME = "seattle.osm.pbf"
const PBF_PATH = path.resolve(__dirname, "../../../fixtures", PBF_NAME)
// fast-osmpbf-js requires .osm.pbf extension
if (!PBF_PATH.endsWith(".osm.pbf")) {
	throw new Error(`PBF fixture must end with .os.pbf: ${PBF_PATH}`)
}

// Verify fixtures exist
if (!(await Bun.file(PBF_PATH).exists())) {
	throw new Error(`PBF fixture not found at: ${PBF_PATH}`)
}

// Address tag keys to filter
const ADDRESS_TAGS = [
	"addr:city",
	"addr:postcode",
	"addr:street",
	"addr:housenumber",
]

const ADDRESS_TAGS_SET = new Set(ADDRESS_TAGS)

// ============================================================================
// Osmix implementations
// ============================================================================

/**
 * Osmix: Count ways using streaming parser (async generator)
 */
async function osmixCountWays(): Promise<number> {
	const { blocks } = await readOsmPbf(Bun.file(PBF_PATH).stream())
	let wayCount = 0

	for await (const block of blocks) {
		for (const group of block.primitivegroup) {
			if (group.ways) {
				wayCount += group.ways.length
			}
		}
	}

	return wayCount
}

/**
 * Osmix: Count ways using TransformStream API
 */
async function osmixCountWaysStream(): Promise<number> {
	let wayCount = 0

	await Bun.file(PBF_PATH)
		.stream()
		.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
		.pipeTo(
			new WritableStream({
				write(block) {
					if ("primitivegroup" in block) {
						for (const group of block.primitivegroup) {
							if (group.ways) {
								wayCount += group.ways.length
							}
						}
					}
				},
			}),
		)

	return wayCount
}

/**
 * Osmix: Count elements with full addresses using streaming parser
 */
async function osmixCountAddresses(): Promise<number> {
	const { blocks } = await readOsmPbf(Bun.file(PBF_PATH).stream())
	let addressCount = 0
	const decoder = new TextDecoder()

	for await (const block of blocks) {
		// stringtable is Uint8Array[] - decode each entry
		const stringTable = block.stringtable.map((s) => decoder.decode(s))

		for (const group of block.primitivegroup) {
			// Check dense nodes
			if (group.dense) {
				const { keys_vals } = group.dense
				let entityTagCount = 0
				const hasAddressTags = new Set<string>()

				for (const kv of keys_vals) {
					if (kv === 0) {
						// End of entity tags
						if (hasAddressTags.size === ADDRESS_TAGS.length) {
							addressCount++
						}
						hasAddressTags.clear()
						entityTagCount = 0
					} else if (entityTagCount % 2 === 0) {
						// Key
						const key = stringTable[kv]
						if (key !== undefined && ADDRESS_TAGS_SET.has(key)) {
							hasAddressTags.add(key)
						}
						entityTagCount++
					} else {
						// Value
						entityTagCount++
					}
				}
			}

			// Check ways
			if (group.ways) {
				for (const way of group.ways) {
					const tags = new Set<string>()
					for (let i = 0; i < way.keys.length; i++) {
						const key = stringTable[way.keys[i]]
						if (key !== undefined && ADDRESS_TAGS_SET.has(key)) {
							tags.add(key)
						}
					}
					if (tags.size === ADDRESS_TAGS.length) {
						addressCount++
					}
				}
			}

			// Check relations
			if (group.relations) {
				for (const relation of group.relations) {
					const tags = new Set<string>()
					for (let i = 0; i < relation.keys.length; i++) {
						const key = stringTable[relation.keys[i]]
						if (key !== undefined && ADDRESS_TAGS_SET.has(key)) {
							tags.add(key)
						}
					}
					if (tags.size === ADDRESS_TAGS.length) {
						addressCount++
					}
				}
			}
		}
	}

	return addressCount
}

// ============================================================================
// fast-osmpbf implementations (single-run only due to library limitations)
// ============================================================================

/**
 * fast-osmpbf: Count ways
 * Uses element filter to only receive ways (avoids sending nodes/relations to JS)
 *
 * WARNING: Can only be called once per process due to fast-osmpbf-js global state bug
 */
async function fastOsmpbfCountWays(): Promise<{
	count: number
	timeMs: number
}> {
	const start = performance.now()
	const reader = new OsmReader(PBF_PATH)
	const elementFilter: JsElementFilter = {
		nodes: false,
		ways: true,
		relations: false,
	}
	const stream = reader.streamBlocks(elementFilter, undefined)
	let wayCount = 0

	let block: JsElementBlock | null = await stream.next()
	while (block !== null) {
		wayCount += block.ids.length
		block = await stream.next()
	}

	return { count: wayCount, timeMs: performance.now() - start }
}

/**
 * fast-osmpbf: Count elements with full addresses
 * Reads all elements without tag filter, then checks tags manually
 *
 * WARNING: Can only be called once per process due to fast-osmpbf-js global state bug
 */
async function fastOsmpbfCountAddresses(): Promise<{
	count: number
	timeMs: number
}> {
	const start = performance.now()
	const reader = new OsmReader(PBF_PATH)
	const stream = reader.streamBlocks(undefined, ADDRESS_TAGS)
	let addressCount = 0

	let block: JsElementBlock | null = null
	while ((block = await stream.next()) !== null) {
		const { ids } = block
		const blockLength = ids.length

		for (let i = 0; i < blockLength; i++) {
			const tags = getTags(block, i)
			if (tags.length === ADDRESS_TAGS.length) {
				addressCount++
			}
		}
	}

	return { count: addressCount, timeMs: performance.now() - start }
}

// ============================================================================
// Main benchmark runner
// ============================================================================

async function main() {
	console.log("OSM PBF Parsing Benchmark: Osmix vs fast-osmpbf-js")
	console.log("==================================================")
	console.log(
		`Fixture: ${PBF_NAME} (${(fs.statSync(PBF_PATH).size / 1024).toFixed(1)} KB)`,
	)
	console.log()

	// Run fast-osmpbf first (can only run once due to library bug)
	console.log(
		"Running fast-osmpbf-js (single run due to library limitations)...",
	)
	const fastWays = await fastOsmpbfCountWays()
	const fastAddresses = await fastOsmpbfCountAddresses()

	console.log()
	console.log("fast-osmpbf-js Results (single run):")
	console.log(
		`  Count Ways:      ${fastWays.count} ways in ${fastWays.timeMs.toFixed(2)}ms`,
	)
	console.log(
		`  Count Addresses: ${fastAddresses.count} addresses in ${fastAddresses.timeMs.toFixed(2)}ms`,
	)
	console.log()

	// Validate Osmix results match
	console.log("Validating Osmix results...")
	const osmixWays = await osmixCountWays()
	const osmixWaysStream = await osmixCountWaysStream()
	const osmixAddresses = await osmixCountAddresses()

	console.log(`  Osmix (generator) ways: ${osmixWays}`)
	console.log(`  Osmix (stream) ways:    ${osmixWaysStream}`)
	console.log(`  Osmix addresses:        ${osmixAddresses}`)

	if (osmixWays !== fastWays.count || osmixWaysStream !== fastWays.count) {
		console.warn("WARNING: Way counts don't match!")
	}
	if (osmixAddresses !== fastAddresses.count) {
		console.warn("WARNING: Address counts don't match!")
	}
	console.log()

	// Run mitata benchmarks for Osmix (statistical sampling)
	console.log("Running Osmix benchmarks with mitata (multiple iterations)...")
	console.log()

	group(`Count Ways - Osmix (${PBF_NAME})`, () => {
		bench("Osmix (generator)", async () => {
			await osmixCountWays()
		})

		bench("Osmix (stream)", async () => {
			await osmixCountWaysStream()
		})
	})

	group(`Count Addresses - Osmix (${PBF_NAME})`, () => {
		bench("Osmix", async () => {
			await osmixCountAddresses()
		})
	})

	await run({
		colors: true,
	})

	// Print comparison summary
	console.log()
	console.log("Summary Comparison")
	console.log("==================")
	console.log(
		"Note: fast-osmpbf-js times are from single run due to library limitations.",
	)
	console.log(
		"Osmix times are averaged from multiple mitata iterations (see above).",
	)
	console.log()
	console.log("Count Ways:")
	console.log(`  fast-osmpbf-js: ${fastWays.timeMs.toFixed(2)}ms (single run)`)
	console.log()
	console.log("Count Addresses:")
	console.log(
		`  fast-osmpbf-js: ${fastAddresses.timeMs.toFixed(2)}ms (single run)`,
	)
}

main().catch(console.error)
