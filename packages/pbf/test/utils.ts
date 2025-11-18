import { expect } from "bun:test"
import type { PbfFixture } from "@osmix/shared/test/fixtures"
import type {
	OsmPbfBlock,
	OsmPbfGroup,
	OsmPbfHeaderBlock,
} from "../src/proto/osmformat"

export async function testOsmPbfReader(
	osm: {
		header: OsmPbfHeaderBlock
		blocks: AsyncGenerator<OsmPbfBlock>
	},
	pbf: PbfFixture,
) {
	expect(osm.header.bbox).toEqual(pbf.bbox)

	const { onGroup, count } = createOsmEntityCounter()
	for await (const block of osm.blocks)
		for (const group of block.primitivegroup) onGroup(group)

	expect(count.nodes).toBe(pbf.nodes)
	expect(count.ways).toBe(pbf.ways)
	expect(count.relations).toBe(pbf.relations)
	expect(count.node0).toBe(pbf.node0.id)
	expect(count.way0).toBe(pbf.way0)
	expect(count.relation0).toBe(pbf.relation0)

	return count
}

export function createOsmEntityCounter() {
	const count = {
		nodes: 0,
		ways: 0,
		relations: 0,
		node0: -1,
		way0: -1,
		relation0: -1,
	}

	const onGroup = (group: OsmPbfGroup) => {
		if (count.node0 === -1 && group.dense?.id?.[0] != null) {
			count.node0 = group.dense.id[0]
		}
		if (count.way0 === -1 && group.ways?.[0]?.id != null) {
			count.way0 = group.ways[0].id
		}
		if (count.relation0 === -1 && group.relations?.[0]?.id != null) {
			count.relation0 = group.relations[0].id
		}

		count.nodes += group.nodes?.length ?? 0
		if (group.dense) {
			count.nodes += group.dense.id.length
		}
		count.ways += group.ways?.length ?? 0
		count.relations += group.relations?.length ?? 0
	}

	return {
		onGroup,
		count,
	}
}
