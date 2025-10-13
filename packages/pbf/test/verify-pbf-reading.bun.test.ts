import { describe, expect, test } from "bun:test"
import { readOsmPbf } from "../src/pbf-to-blocks"
import { getFixtureFile } from "@osmix/test-utils/fixtures"

describe("PBF Reading with Bun", () => {
	test("can read an actual OSM PBF file", async () => {
		// Load a real PBF fixture
		const pbfData = await getFixtureFile('monaco.pbf')

		// Try to read it
		const result = await readOsmPbf(pbfData)

		// Basic sanity checks
		expect(result.header).toBeDefined()
		expect(result.header.required_features).toBeDefined()
		expect(result.blocks).toBeDefined()

		// Try to read at least one block
		const firstBlock = await result.blocks.next()
		expect(firstBlock.done).toBe(false)
		expect(firstBlock.value).toBeDefined()

		// If it's a primitive block, it should have primitivegroup
		if ("primitivegroup" in firstBlock.value) {
			expect(Array.isArray(firstBlock.value.primitivegroup)).toBe(true)
		}
	})

	test("header contains expected OSM data", async () => {
		const pbfData = await getFixtureFile('monaco.pbf')

		const result = await readOsmPbf(pbfData)

		// Check that header has the required OSM features
		expect(result.header.required_features).toBeDefined()
		expect(result.header.required_features.length).toBeGreaterThan(0)
	})
})

