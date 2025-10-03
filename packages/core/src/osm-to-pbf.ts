import { type OsmEntity, OsmJsonToBlocksTransformStream } from "@osmix/json"
import {
	OsmBlocksToPbfBytesTransformStream,
	type OsmPbfHeaderBlock,
} from "@osmix/pbf"
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
	return createOsmEntityReadableStream(osm)
		.pipeThrough(new OsmJsonToBlocksTransformStream())
		.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
		.pipeTo(stream)
}

/**
 * Create a readable stream of OSM PBF blocks from an OSM object.
 *
 * @param osm - The OSM object to create a readable stream from.
 * @returns A readable stream of OSM PBF blocks.
 */
export function createOsmEntityReadableStream(osm: Osm) {
	let headerEnqueued = false
	const entityGenerator = osm.generateSortedEntities()
	return new ReadableStream<OsmPbfHeaderBlock | OsmEntity>({
		pull: async (controller) => {
			if (!headerEnqueued) {
				const [left, bottom, right, top] = osm.nodes.bbox
				controller.enqueue({
					...osm.header,
					bbox: {
						left,
						bottom,
						right,
						top,
					},
					writingprogram: "@osmix/core",
					osmosis_replication_timestamp: Date.now(),
				})
				headerEnqueued = true
			}
			const block = entityGenerator.next()
			if (block.done) {
				controller.close()
			} else {
				controller.enqueue(block.value)
			}
		},
	})
}
