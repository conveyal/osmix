import type { PbfFixture } from "@osmix/shared/test/fixtures"
import { assert } from "vitest"
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
	assert.deepEqual(osm.header.bbox, pbf.bbox)

	const { onGroup, count } = createOsmEntityCounter()
	for await (const block of osm.blocks)
		for (const group of block.primitivegroup) onGroup(group)

	assert.equal(count.nodes, pbf.nodes)
	assert.equal(count.ways, pbf.ways)
	assert.equal(count.relations, pbf.relations)
	assert.equal(count.node0, pbf.node0.id)
	assert.equal(count.way0, pbf.way0)
	assert.equal(count.relation0, pbf.relation0)

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
