import { assert, describe, expect, it } from "vitest"
import { OsmPbfBlockBuilder } from "../src/osm-pbf-block-builder"
import { OsmPbfBlockParser } from "../src/osm-pbf-block-parser"
import { blocksToJsonEntities } from "../src/pbf-to-json"

describe("OsmPbfBlockParser", () => {
	it("parses primitive groups with tags and info", () => {
		const builder = new OsmPbfBlockBuilder({
			includeInfo: true,
			date_granularity: 1,
			granularity: 1,
		})

		builder.addNode({
			id: 1,
			lat: 40,
			lon: -75,
			tags: { name: "node" },
			info: {
				version: 3,
				timestamp: 4_000,
				changeset: 6,
				uid: 7,
				user: "alice",
			},
		})

		builder.addDenseNode({
			id: 2,
			lat: 41,
			lon: -74,
			tags: { amenity: "cafe" },
			info: {
				version: 1,
				timestamp: 2_000,
				changeset: 11,
				uid: 10,
				user_sid: 5,
				visible: true,
			},
		})

		builder.addWay({
			id: 3,
			refs: [1, 2, 1],
			tags: { highway: "service" },
			info: {
				version: 2,
				timestamp: 6_000,
				changeset: 12,
				uid: 9,
				user: "bob",
			},
		})

		builder.addRelation({
			id: 4,
			members: [
				{
					type: "node",
					ref: 1,
					role: "outer",
				},
				{
					type: "way",
					ref: 3,
					role: "inner",
				},
			],
			tags: { type: "multipolygon" },
			info: {
				version: 1,
				timestamp: 8_000,
				changeset: 13,
				uid: 11,
				user: "carol",
			},
		})

		const parser = new OsmPbfBlockParser(builder, {
			includeInfo: true,
		})
		const group = builder.primitivegroup[0]

		assert.exists(group?.nodes[0])
		const node = parser.parseNode(group.nodes[0], { includeInfo: true })
		expect(node).toEqual({
			id: 1,
			lat: 40,
			lon: -75,
			tags: { name: "node" },
			info: {
				version: 3,
				timestamp: 4_000,
				changeset: 6,
				uid: 7,
				user: "alice",
				user_sid: expect.any(Number),
			},
		})

		const denseGroup = group.dense
		if (!denseGroup) throw new Error("expected dense nodes in block")
		const [denseNode] = parser.parseDenseNodes(denseGroup, {
			includeInfo: true,
		})
		expect(denseNode).toEqual({
			id: 2,
			lat: 41,
			lon: -74,
			tags: { amenity: "cafe" },
			info: {
				version: 1,
				timestamp: 2_000,
				changeset: 11,
				uid: 10,
				user_sid: 5,
				visible: true,
			},
		})

		assert.exists(group?.ways[0])
		const way = parser.parseWay(group.ways[0], { includeInfo: true })
		expect(way).toEqual({
			id: 3,
			refs: [1, 2, 1],
			tags: { highway: "service" },
			info: {
				version: 2,
				timestamp: 6_000,
				changeset: 12,
				uid: 9,
				user: "bob",
				user_sid: expect.any(Number),
			},
		})

		assert.exists(group?.relations[0])
		const relation = parser.parseRelation(group.relations[0], {
			includeInfo: true,
		})
		expect(relation).toEqual({
			id: 4,
			members: [
				{
					type: "node",
					ref: 1,
					role: "outer",
				},
				{
					type: "way",
					ref: 3,
					role: "inner",
				},
			],
			tags: { type: "multipolygon" },
			info: {
				version: 1,
				timestamp: 8_000,
				changeset: 13,
				uid: 11,
				user: "carol",
				user_sid: expect.any(Number),
			},
		})
	})

	it("emits entities via blocksToJsonEntities", () => {
		const builder = new OsmPbfBlockBuilder()
		builder.addDenseNode({ id: 1, lat: 0, lon: 0 })
		builder.addWay({ id: 2, refs: [1, 3], tags: { highway: "service" } })
		const entities = Array.from(blocksToJsonEntities(builder))
		expect(entities).toHaveLength(2)
		expect(entities[0]).toMatchObject({ id: 1, lat: 0, lon: 0 })
		expect(entities[1]).toMatchObject({ id: 2, refs: [1, 3] })
	})
})
