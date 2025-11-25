import { describe, expect, it } from "bun:test"
import { Nodes, Relations, Ways } from "../src"

describe("Memory Requirements", () => {
	it("returns zero for empty datasets", () => {
		expect(Nodes.getBytesRequired(0)).toBe(0)
		expect(Ways.getBytesRequired(0)).toBe(0)
		expect(Relations.getBytesRequired(0)).toBe(0)
	})

	it("returns positive values for non-empty datasets", () => {
		expect(Nodes.getBytesRequired(100)).toBeGreaterThan(0)
		expect(Ways.getBytesRequired(100)).toBeGreaterThan(0)
		expect(Relations.getBytesRequired(100)).toBeGreaterThan(0)
	})

	it("scales with dataset size", () => {
		const smallNodes = Nodes.getBytesRequired(100)
		const largeNodes = Nodes.getBytesRequired(10000)
		expect(largeNodes).toBeGreaterThan(smallNodes)

		const smallWays = Ways.getBytesRequired(100)
		const largeWays = Ways.getBytesRequired(10000)
		expect(largeWays).toBeGreaterThan(smallWays)
	})
})
