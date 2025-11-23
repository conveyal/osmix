import { describe, expect, it } from "bun:test"
import { Nodes, Relations, Ways } from "../src"

export function getOsmCoreMemoryRequirements(
	nodeCount: number,
	wayCount: number,
	relationCount: number,
) {
	const nodesBytes = Nodes.getBytesRequired(nodeCount)
	const waysBytes = Ways.getBytesRequired(wayCount)
	const relationsBytes = Relations.getBytesRequired(relationCount)

	return {
		nodes: nodesBytes,
		ways: waysBytes,
		relations: relationsBytes,
		total: nodesBytes + waysBytes + relationsBytes,
	}
}

describe("Memory Requirements", () => {
	it("computes memory requirements for small datasets", () => {
		const breakdown = getOsmCoreMemoryRequirements(10, 2, 1)
		expect(breakdown.nodes).toBeGreaterThan(0)
		expect(breakdown.ways).toBeGreaterThan(0)
		expect(breakdown.relations).toBeGreaterThan(0)
		expect(breakdown.total).toBe(
			breakdown.nodes + breakdown.ways + breakdown.relations,
		)
	})

	it("computes memory requirements for large datasets", () => {
		const breakdown = getOsmCoreMemoryRequirements(70000, 20000, 0)
		expect(breakdown.nodes).toBeGreaterThan(0)
		expect(breakdown.ways).toBeGreaterThan(0)
		expect(breakdown.total).toBe(breakdown.nodes + breakdown.ways)
	})
})
