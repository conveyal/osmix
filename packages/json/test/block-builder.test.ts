import { assert, describe, expect, it } from "vitest"
import { OsmPbfBlockBuilder } from "../src/osm-pbf-block-builder"

const decoder = new TextDecoder()

function decodeStringtable(builder: OsmPbfBlockBuilder) {
	return builder.stringtable.map((entry) => decoder.decode(entry))
}

describe("OsmPbfBlockBuilder", () => {
	it("delta encodes dense nodes and collects tags", () => {
		const builder = new OsmPbfBlockBuilder({
			includeInfo: true,
			date_granularity: 1_000,
			granularity: 1,
		})

		builder.addDenseNode({
			id: 5,
			lat: 10,
			lon: 20,
			tags: { name: "first" },
			info: {
				version: 1,
				timestamp: 2_000,
				changeset: 10,
				uid: 12,
				user_sid: 7,
				visible: true,
			},
		})

		builder.addDenseNode({
			id: 6,
			lat: 11,
			lon: 21,
			tags: { name: "second" },
			info: {
				version: 2,
				timestamp: 5_000,
				changeset: 15,
				uid: 20,
				user_sid: 8,
				visible: false,
			},
		})

		assert.exists(builder.primitivegroup?.[0]?.dense)
		const dense = builder.primitivegroup[0].dense
		expect(dense).toBeDefined()
		expect(dense?.id).toEqual([5, 1])
		expect(dense?.lat).toEqual([10, 1])
		expect(dense?.lon).toEqual([20, 1])
		expect(dense?.keys_vals).toEqual([1, 2, 0, 1, 3, 0])
		expect(dense?.denseinfo?.version).toEqual([1, 2])
		expect(dense?.denseinfo?.timestamp).toEqual([2, 3])
		expect(dense?.denseinfo?.changeset).toEqual([10, 5])
		expect(dense?.denseinfo?.uid).toEqual([12, 8])
		expect(dense?.denseinfo?.user_sid).toEqual([7, 1])
		expect(dense?.denseinfo?.visible).toEqual([true, false])
		expect(decodeStringtable(builder)).toEqual(["", "name", "first", "second"])
	})

	it("encodes ways and relations with delta members", () => {
		const builder = new OsmPbfBlockBuilder({ includeInfo: true })

		builder.addWay({
			id: 7,
			refs: [10, 11, 15],
			tags: { highway: "service" },
			info: {
				version: 1,
				timestamp: 1_000,
				changeset: 3,
				uid: 4,
				user: "way",
			},
		})

		builder.addRelation({
			id: 9,
			members: [
				{
					type: "node",
					ref: 8,
					role: "outer",
				},
				{
					type: "way",
					ref: 12,
					role: "inner",
				},
			],
			tags: { type: "multipolygon" },
			info: {
				version: 3,
				timestamp: 2_000,
				changeset: 4,
				uid: 5,
				user: "relation",
			},
		})

		const group = builder.primitivegroup[0]
		assert.exists(group?.ways[0])
		expect(group.ways).toHaveLength(1)
		expect(group.ways[0].refs).toEqual([10, 1, 4])
		expect(group.ways[0].keys).toHaveLength(1)
		expect(group.ways[0].vals).toHaveLength(1)
		expect(group.relations).toHaveLength(1)
		assert.exists(group?.relations[0])
		expect(group.relations[0].memids).toEqual([8, 4])
		expect(group.relations[0].roles_sid).toHaveLength(2)
		expect(group.relations[0].types).toEqual([0, 1])
	})

	it("reports block capacity", () => {
		const builder = new OsmPbfBlockBuilder({ maxEntitiesPerBlock: 2 })
		expect(builder.isEmpty()).toBe(true)
		builder.addDenseNode({
			id: 1,
			lat: 0,
			lon: 0,
		})
		expect(builder.isFull()).toBe(false)
		builder.addDenseNode({
			id: 2,
			lat: 0,
			lon: 0,
		})
		expect(builder.isFull()).toBe(true)
	})
})
