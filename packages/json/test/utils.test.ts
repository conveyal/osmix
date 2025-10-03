import { describe, expect, it } from "vitest"
import {
	entityPropertiesEqual,
	getEntityType,
	isNode,
	isNodeEqual,
	isRelation,
	isRelationEqual,
	isWay,
	isWayEqual,
} from "../src/utils"
import type {
	OsmNode,
	OsmRelation,
	OsmRelationMember,
	OsmWay,
} from "../src/types"

describe("utils", () => {
	const node: OsmNode = {
		id: 1,
		lat: 10,
		lon: 20,
		tags: { name: "node" },
	}
	const way: OsmWay = {
		id: 2,
		refs: [1, 2, 3],
		tags: { highway: "residential" },
	}
	const members: OsmRelationMember[] = [
		{
			type: "node",
			ref: 1,
		},
	]
	const relation: OsmRelation = {
		id: 3,
		members,
		tags: { type: "multipolygon" },
	}

	it("narrows entity types", () => {
		expect(isNode(node)).toBe(true)
		expect(isWay(way)).toBe(true)
		expect(isRelation(relation)).toBe(true)
	})

	it("compares entity equality", () => {
		expect(isNodeEqual(node, { ...node })).toBe(true)
		expect(isWayEqual(way, { ...way })).toBe(true)
		expect(isRelationEqual(relation, { ...relation })).toBe(true)
	})

	it("detects property differences", () => {
		expect(
			entityPropertiesEqual(node, { ...node, tags: { name: "changed" } }),
		).toBe(false)
		expect(
			entityPropertiesEqual(way, { ...way, refs: [1, 2, 4] }),
		).toBe(false)
		expect(
			entityPropertiesEqual(relation, {
				...relation,
				members: [{ type: "node", ref: 2 }],
			}),
		).toBe(false)
	})

	it("provides entity type", () => {
		expect(getEntityType(node)).toBe("node")
		expect(getEntityType(way)).toBe("way")
		expect(getEntityType(relation)).toBe("relation")
	})
})
