import { describe, expect, it } from "bun:test"
import {
	buildRelationLineStrings,
	collectRelationPoints,
	getRelationKind,
	getRelationKindMetadata,
	isAreaRelation,
	isLineRelation,
	isLogicRelation,
	isPointRelation,
	isSuperRelation,
	resolveRelationMembers,
} from "../src/relation-kind"
import type { LonLat, OsmRelation, OsmWay } from "../src/types"

describe("relation-kind", () => {
	describe("getRelationKind", () => {
		it("identifies multipolygon as area", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [],
			}
			expect(getRelationKind(relation)).toBe("area")
		})

		it("identifies boundary as area", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "boundary" },
				members: [],
			}
			expect(getRelationKind(relation)).toBe("area")
		})

		it("identifies route as line", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "route" },
				members: [],
			}
			expect(getRelationKind(relation)).toBe("line")
		})

		it("identifies multilinestring as line", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multilinestring" },
				members: [],
			}
			expect(getRelationKind(relation)).toBe("line")
		})

		it("identifies multipoint as point", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipoint" },
				members: [],
			}
			expect(getRelationKind(relation)).toBe("point")
		})

		it("identifies restriction as logic", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "restriction" },
				members: [],
			}
			expect(getRelationKind(relation)).toBe("logic")
		})

		it("identifies super-relation by having relation members", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "collection" },
				members: [{ type: "relation", ref: 2 }],
			}
			expect(getRelationKind(relation)).toBe("super")
		})

		it("defaults to logic for untyped relations", () => {
			const relation: OsmRelation = {
				id: 1,
				members: [],
			}
			expect(getRelationKind(relation)).toBe("logic")
		})

		it("handles case-insensitive type tags", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "MULTIPOLYGON" },
				members: [],
			}
			expect(getRelationKind(relation)).toBe("area")
		})
	})

	describe("getRelationKindMetadata", () => {
		it("returns correct metadata for area relations", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [],
			}
			const metadata = getRelationKindMetadata(relation)
			expect(metadata.kind).toBe("area")
			expect(metadata.expectedRoles).toEqual(["outer", "inner"])
			expect(metadata.orderMatters).toBe(false)
		})

		it("returns correct metadata for line relations", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "route" },
				members: [],
			}
			const metadata = getRelationKindMetadata(relation)
			expect(metadata.kind).toBe("line")
			expect(metadata.orderMatters).toBe(true)
		})
	})

	describe("isAreaRelation", () => {
		it("returns true for multipolygon", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [],
			}
			expect(isAreaRelation(relation)).toBe(true)
		})

		it("returns false for route", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "route" },
				members: [],
			}
			expect(isAreaRelation(relation)).toBe(false)
		})
	})

	describe("isLineRelation", () => {
		it("returns true for route", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "route" },
				members: [],
			}
			expect(isLineRelation(relation)).toBe(true)
		})

		it("returns true for multilinestring", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multilinestring" },
				members: [],
			}
			expect(isLineRelation(relation)).toBe(true)
		})
	})

	describe("isPointRelation", () => {
		it("returns true for multipoint", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipoint" },
				members: [],
			}
			expect(isPointRelation(relation)).toBe(true)
		})
	})

	describe("isSuperRelation", () => {
		it("returns true for relation with relation members", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "collection" },
				members: [{ type: "relation", ref: 2 }],
			}
			expect(isSuperRelation(relation)).toBe(true)
		})

		it("returns false for relation without relation members", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "route" },
				members: [{ type: "way", ref: 2 }],
			}
			expect(isSuperRelation(relation)).toBe(false)
		})
	})

	describe("isLogicRelation", () => {
		it("returns true for restriction", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "restriction" },
				members: [],
			}
			expect(isLogicRelation(relation)).toBe(true)
		})
	})

	describe("buildRelationLineStrings", () => {
		it("builds linestrings from connected ways", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "route" },
				members: [
					{ type: "way", ref: 1 },
					{ type: "way", ref: 2 },
				],
			}

			const way1: OsmWay = { id: 1, refs: [1, 2] }
			const way2: OsmWay = { id: 2, refs: [2, 3] }

			const getWay = (id: number) => {
				if (id === 1) return way1
				if (id === 2) return way2
				return null
			}

			const getNodeCoordinates = (id: number) => {
				const coords: Record<number, [number, number]> = {
					1: [0.0, 0.0],
					2: [1.0, 0.0],
					3: [2.0, 0.0],
				}
				return coords[id]
			}

			const lineStrings = buildRelationLineStrings(
				relation,
				getWay,
				getNodeCoordinates,
			)
			expect(lineStrings).toHaveLength(1)
			expect(lineStrings[0]).toHaveLength(3)
		})

		it("handles disconnected ways as separate linestrings", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "route" },
				members: [
					{ type: "way", ref: 1 },
					{ type: "way", ref: 2 },
				],
			}

			const way1: OsmWay = { id: 1, refs: [1, 2] }
			const way2: OsmWay = { id: 2, refs: [3, 4] }

			const getWay = (id: number) => {
				if (id === 1) return way1
				if (id === 2) return way2
				return null
			}

			const getNodeCoordinates = (id: number) => {
				const coords: Record<number, [number, number]> = {
					1: [0.0, 0.0],
					2: [1.0, 0.0],
					3: [10.0, 10.0],
					4: [11.0, 10.0],
				}
				return coords[id]
			}

			const lineStrings = buildRelationLineStrings(
				relation,
				getWay,
				getNodeCoordinates,
			)
			expect(lineStrings.length).toBeGreaterThanOrEqual(2)
		})
	})

	describe("collectRelationPoints", () => {
		it("collects point coordinates from node members", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipoint" },
				members: [
					{ type: "node", ref: 1 },
					{ type: "node", ref: 2 },
					{ type: "way", ref: 10 }, // Should be ignored
				],
			}

			const getNodeCoordinates = (id: number) => {
				const coords: Record<number, [number, number]> = {
					1: [0.0, 0.0],
					2: [1.0, 1.0],
				}
				return coords[id]
			}

			const points = collectRelationPoints(relation, getNodeCoordinates)
			expect(points).toHaveLength(2)
			expect(points[0]).toEqual([0.0, 0.0])
			expect(points[1]).toEqual([1.0, 1.0])
		})

		it("handles missing node coordinates", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipoint" },
				members: [
					{ type: "node", ref: 1 },
					{ type: "node", ref: 2 },
				],
			}

			const getNodeCoordinates = (id: number): LonLat | undefined => {
				if (id === 1) return [0.0, 0.0] as LonLat
				return undefined // Missing coordinate
			}

			const points = collectRelationPoints(relation, getNodeCoordinates)
			expect(points).toHaveLength(1)
		})
	})

	describe("resolveRelationMembers", () => {
		it("resolves direct members", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "collection" },
				members: [
					{ type: "node", ref: 1 },
					{ type: "way", ref: 10 },
				],
			}

			const getRelation = () => null

			const resolved = resolveRelationMembers(relation, getRelation)
			expect(resolved.nodes).toEqual([1])
			expect(resolved.ways).toEqual([10])
			expect(resolved.relations).toEqual([])
		})

		it("resolves nested relation members", () => {
			const relation1: OsmRelation = {
				id: 1,
				tags: { type: "collection" },
				members: [
					{ type: "relation", ref: 2 },
					{ type: "node", ref: 1 },
				],
			}

			const relation2: OsmRelation = {
				id: 2,
				tags: { type: "collection" },
				members: [
					{ type: "way", ref: 10 },
					{ type: "node", ref: 2 },
				],
			}

			const getRelation = (id: number) => {
				if (id === 2) return relation2
				return null
			}

			const resolved = resolveRelationMembers(relation1, getRelation)
			expect(resolved.nodes).toContain(1)
			expect(resolved.nodes).toContain(2)
			expect(resolved.ways).toContain(10)
			expect(resolved.relations).toContain(2)
		})

		it("detects cycles and prevents infinite recursion", () => {
			const relation1: OsmRelation = {
				id: 1,
				tags: { type: "collection" },
				members: [{ type: "relation", ref: 2 }],
			}

			const relation2: OsmRelation = {
				id: 2,
				tags: { type: "collection" },
				members: [{ type: "relation", ref: 1 }], // Circular reference
			}

			const getRelation = (id: number) => {
				if (id === 1) return relation1
				if (id === 2) return relation2
				return null
			}

			const resolved = resolveRelationMembers(relation1, getRelation, 10)
			// Should not crash and should include relation2 but not recurse infinitely
			expect(resolved.relations).toContain(2)
		})

		it("respects maxDepth limit", () => {
			const relation1: OsmRelation = {
				id: 1,
				tags: { type: "collection" },
				members: [{ type: "relation", ref: 2 }],
			}

			const relation2: OsmRelation = {
				id: 2,
				tags: { type: "collection" },
				members: [{ type: "node", ref: 100 }],
			}

			const getRelation = (id: number) => {
				if (id === 1) return relation1
				if (id === 2) return relation2
				return null
			}

			const resolved = resolveRelationMembers(relation1, getRelation, 0)
			// Should not resolve nested relation when maxDepth is 0
			expect(resolved.nodes).not.toContain(100)
		})
	})
})
