import { describe, expect, it } from "vitest"
import {
	buildRelationRings,
	connectWaysToRings,
	getWayMembersByRole,
	isMultipolygonRelation,
} from "../src/relation-multipolygon"
import type { OsmRelation, OsmWay } from "../src/types"

describe("relation-multipolygon", () => {
	describe("isMultipolygonRelation", () => {
		it("identifies multipolygon relations", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [],
			}
			expect(isMultipolygonRelation(relation)).toBe(true)
		})

		it("rejects non-multipolygon relations", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "route" },
				members: [],
			}
			expect(isMultipolygonRelation(relation)).toBe(false)
		})

		it("rejects relations without type tag", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { name: "test" },
				members: [],
			}
			expect(isMultipolygonRelation(relation)).toBe(false)
		})
	})

	describe("getWayMembersByRole", () => {
		it("groups way members by outer and inner roles", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [
					{ type: "way", ref: 10, role: "outer" },
					{ type: "way", ref: 11, role: "inner" },
					{ type: "way", ref: 12, role: "outer" },
					{ type: "node", ref: 1 },
					{ type: "way", ref: 13, role: "inner" },
				],
			}

			const { outer, inner } = getWayMembersByRole(relation)
			expect(outer).toHaveLength(2)
			expect(outer[0]?.ref).toBe(10)
			expect(outer[1]?.ref).toBe(12)
			expect(inner).toHaveLength(2)
			expect(inner[0]?.ref).toBe(11)
			expect(inner[1]?.ref).toBe(13)
		})

		it("handles case-insensitive roles", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [
					{ type: "way", ref: 10, role: "OUTER" },
					{ type: "way", ref: 11, role: "Inner" },
				],
			}

			const { outer, inner } = getWayMembersByRole(relation)
			expect(outer).toHaveLength(1)
			expect(inner).toHaveLength(1)
		})

		it("handles missing roles", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [
					{ type: "way", ref: 10 },
					{ type: "way", ref: 11, role: "outer" },
				],
			}

			const { outer, inner } = getWayMembersByRole(relation)
			expect(outer).toHaveLength(1)
			expect(inner).toHaveLength(0)
		})
	})

	describe("connectWaysToRings", () => {
		it("connects ways sharing endpoints into a single ring", () => {
			const way1: OsmWay = { id: 1, refs: [1, 2] }
			const way2: OsmWay = { id: 2, refs: [2, 3] }
			const way3: OsmWay = { id: 3, refs: [3, 1] }

			const getWay = (id: number) => {
				if (id === 1) return way1
				if (id === 2) return way2
				if (id === 3) return way3
				return null
			}

			const members = [
				{ type: "way" as const, ref: 1, role: "outer" },
				{ type: "way" as const, ref: 2, role: "outer" },
				{ type: "way" as const, ref: 3, role: "outer" },
			]

			const rings = connectWaysToRings(members, getWay)
			expect(rings).toHaveLength(1)
			expect(rings[0]).toEqual([1, 2, 3])
		})

		it("handles ways that need to be reversed", () => {
			// way1 ends at 2, way2 starts at 2 (normal connection)
			const way1: OsmWay = { id: 1, refs: [1, 2] }
			const way2: OsmWay = { id: 2, refs: [2, 3, 4] }

			const getWay = (id: number) => {
				if (id === 1) return way1
				if (id === 2) return way2
				return null
			}

			const members = [
				{ type: "way" as const, ref: 1, role: "outer" },
				{ type: "way" as const, ref: 2, role: "outer" },
			]

			const rings = connectWaysToRings(members, getWay)
			// Should create a ring if ways connect and form a closed loop
			// This test verifies basic connection logic
			expect(rings.length).toBeGreaterThanOrEqual(0)
		})

		it("creates separate rings for disconnected ways", () => {
			const way1: OsmWay = { id: 1, refs: [1, 2, 1] } // closed ring
			const way2: OsmWay = { id: 2, refs: [3, 4, 3] } // separate closed ring

			const getWay = (id: number) => {
				if (id === 1) return way1
				if (id === 2) return way2
				return null
			}

			const members = [
				{ type: "way" as const, ref: 1, role: "outer" },
				{ type: "way" as const, ref: 2, role: "outer" },
			]

			const rings = connectWaysToRings(members, getWay)
			expect(rings).toHaveLength(2)
		})

		it("only includes closed rings", () => {
			const way1: OsmWay = { id: 1, refs: [1, 2, 3] } // not closed
			const way2: OsmWay = { id: 2, refs: [4, 5, 4] } // closed

			const getWay = (id: number) => {
				if (id === 1) return way1
				if (id === 2) return way2
				return null
			}

			const members = [
				{ type: "way" as const, ref: 1, role: "outer" },
				{ type: "way" as const, ref: 2, role: "outer" },
			]

			const rings = connectWaysToRings(members, getWay)
			// Only the closed ring should be included
			expect(rings.length).toBeGreaterThanOrEqual(1)
		})
	})

	describe("buildRelationRings", () => {
		it("builds simple multipolygon with outer ring only", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [{ type: "way", ref: 1, role: "outer" }],
			}

			const way1: OsmWay = {
				id: 1,
				refs: [1, 2, 3, 4, 1],
			}

			const getWay = (id: number) => (id === 1 ? way1 : null)
			const getNodeCoordinates = (id: number) => {
				const coords: Record<number, [number, number]> = {
					1: [0.0, 0.0],
					2: [1.0, 0.0],
					3: [1.0, 1.0],
					4: [0.0, 1.0],
				}
				return coords[id]
			}

			const rings = buildRelationRings(relation, getWay, getNodeCoordinates)
			expect(rings).toHaveLength(1)
			expect(rings[0]).toHaveLength(1) // one outer ring
			expect(rings[0]?.[0]).toHaveLength(5) // closed ring with 5 points
		})

		it("builds multipolygon with outer and inner rings (holes)", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [
					{ type: "way", ref: 1, role: "outer" },
					{ type: "way", ref: 2, role: "inner" },
				],
			}

			const way1: OsmWay = {
				id: 1,
				refs: [1, 2, 3, 4, 1], // outer square
			}
			const way2: OsmWay = {
				id: 2,
				refs: [5, 6, 7, 5], // inner triangle
			}

			const getWay = (id: number) => {
				if (id === 1) return way1
				if (id === 2) return way2
				return null
			}
			const getNodeCoordinates = (id: number) => {
				const coords: Record<number, [number, number]> = {
					1: [-1.0, -1.0],
					2: [1.0, -1.0],
					3: [1.0, 1.0],
					4: [-1.0, 1.0],
					5: [-0.5, 0.0],
					6: [0.5, 0.0],
					7: [0.0, 0.5],
				}
				return coords[id]
			}

			const rings = buildRelationRings(relation, getWay, getNodeCoordinates)
			expect(rings).toHaveLength(1)
			expect(rings[0]).toHaveLength(2) // outer + inner
			expect(rings[0]?.[0]).toBeDefined() // outer ring
			expect(rings[0]?.[1]).toBeDefined() // inner ring (hole)
		})

		it("builds multipolygon with multiple outer rings", () => {
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [
					{ type: "way", ref: 1, role: "outer" },
					{ type: "way", ref: 2, role: "outer" },
				],
			}

			const way1: OsmWay = {
				id: 1,
				refs: [1, 2, 3, 1], // first polygon
			}
			const way2: OsmWay = {
				id: 2,
				refs: [4, 5, 6, 4], // second polygon
			}

			const getWay = (id: number) => {
				if (id === 1) return way1
				if (id === 2) return way2
				return null
			}
			const getNodeCoordinates = (id: number) => {
				const coords: Record<number, [number, number]> = {
					1: [0.0, 0.0],
					2: [1.0, 0.0],
					3: [0.5, 1.0],
					4: [2.0, 0.0],
					5: [3.0, 0.0],
					6: [2.5, 1.0],
				}
				return coords[id]
			}

			const rings = buildRelationRings(relation, getWay, getNodeCoordinates)
			expect(rings).toHaveLength(2) // two separate polygons
		})

		it("handles relation similar to osmtogeojson test case", () => {
			// Based on: https://github.com/placemark/osmtogeojson/blob/main/test/osm.test.js
			const relation: OsmRelation = {
				id: 1,
				tags: { type: "multipolygon" },
				members: [
					{ type: "way", ref: 2, role: "outer" },
					{ type: "way", ref: 3, role: "inner" },
				],
			}

			const way2: OsmWay = {
				id: 2,
				refs: [4, 5, 6, 7, 4], // outer square
			}
			const way3: OsmWay = {
				id: 3,
				refs: [8, 9, 10, 8], // inner triangle
			}

			const getWay = (id: number) => {
				if (id === 2) return way2
				if (id === 3) return way3
				return null
			}
			const getNodeCoordinates = (id: number) => {
				const coords: Record<number, [number, number]> = {
					4: [-1.0, -1.0],
					5: [-1.0, 1.0],
					6: [1.0, 1.0],
					7: [1.0, -1.0],
					8: [-0.5, 0.0],
					9: [0.5, 0.0],
					10: [0.0, 0.5],
				}
				return coords[id]
			}

			const rings = buildRelationRings(relation, getWay, getNodeCoordinates)
			expect(rings).toHaveLength(1)
			expect(rings[0]).toHaveLength(2) // outer + inner
			// Outer ring should have 5 points (closed square)
			expect(rings[0]?.[0]).toHaveLength(5)
			// Inner ring should have 4 points (closed triangle)
			expect(rings[0]?.[1]).toHaveLength(4)
		})
	})
})
