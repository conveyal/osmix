import type { Osm } from "./osm"
import { OsmPbfBlockBuilder, OsmPbfWriter } from "./pbf"

/**
 * Write an OSM object to a PBF stream.
 *
 * @param osm - The OSM object to write.
 * @param stream - The stream to write the PBF to.
 */
export async function writeOsmToPbfStream(
	osm: Osm,
	stream: WritableStream<Uint8Array>,
) {
	const writer = new OsmPbfWriter(stream)
	const [left, bottom, right, top] = osm.nodes.bbox
	await writer.writeHeader({
		...osm.header,
		bbox: {
			left,
			bottom,
			right,
			top,
		},
		writingprogram: "@conveyal/osm.ts",
		osmosis_replication_timestamp: Date.now(),
	})
	for (const block of generatePbfPrimitiveBlocks(osm)) {
		await writer.writePrimitiveBlock(block)
	}
	await writer.close()
}

/**
 * Generate primitive blocks from an OSM object for writing to a PBF file.
 *
 * @param osm - The OSM object to generate primitive blocks from.
 * @returns a generator that produces primitive blocks
 */
export function* generatePbfPrimitiveBlocks(
	osm: Osm,
	includeInfo = false,
): Generator<OsmPbfBlockBuilder> {
	let block = new OsmPbfBlockBuilder({ includeInfo })
	for (const node of osm.nodes) {
		if (block.isFull()) {
			yield block
			block = new OsmPbfBlockBuilder()
		}
		block.addDenseNode(node)
	}
	if (!block.isEmpty()) {
		yield block
	}

	block = new OsmPbfBlockBuilder({ includeInfo })
	for (const way of osm.ways) {
		if (block.isFull()) {
			yield block
			block = new OsmPbfBlockBuilder()
		}
		block.addWay(way)
	}
	if (!block.isEmpty()) {
		yield block
	}

	block = new OsmPbfBlockBuilder({ includeInfo })
	for (const relation of osm.relations) {
		if (block.isFull()) {
			yield block
			block = new OsmPbfBlockBuilder()
		}
		block.addRelation(relation)
	}
	if (!block.isEmpty()) {
		yield block
	}
}
