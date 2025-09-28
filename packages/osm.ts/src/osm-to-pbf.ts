import {
	OsmBlocksToPbfBytesTransformStream,
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
} from "@osmix/pbf"
import { OsmPbfBlockBuilder } from "./json/osm-pbf-block-builder"
import type { Osm } from "./osm"

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
	return new OsmToBlocksReadableStream(osm)
		.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
		.pipeTo(stream)
}

/**
 * Create a readable stream of OSM PBF blocks from an OSM object.
 *
 * @param osm - The OSM object to create a readable stream from.
 * @returns A readable stream of OSM PBF blocks.
 */
export class OsmToBlocksReadableStream extends ReadableStream<
	OsmPbfHeaderBlock | OsmPbfBlock
> {
	constructor(osm: Osm) {
		let blocksGenerator: ReturnType<typeof generatePbfPrimitiveBlocks> | null =
			null
		super({
			pull: async (controller) => {
				if (blocksGenerator == null) {
					const [left, bottom, right, top] = osm.nodes.bbox
					controller.enqueue({
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
					blocksGenerator = generatePbfPrimitiveBlocks(osm)
				}
				const block = blocksGenerator.next()
				if (block.done) {
					controller.close()
				} else {
					controller.enqueue(block.value)
				}
			},
		})
	}
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
	for (const node of osm.nodes.sorted()) {
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
	for (const way of osm.ways.sorted()) {
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
	for (const relation of osm.relations.sorted()) {
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
