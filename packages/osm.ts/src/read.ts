import { createOsmPbfReadStream } from "./create-osm-pbf-read-stream"
import {
	type ReadOptions,
	readOsmPbfPrimitiveBlocks,
} from "./read-osm-pbf-blocks"

export * from "./create-osm-pbf-read-stream"
export * from "./read-osm-pbf-blocks"

export async function readOsmPbf(
	stream: ReadableStream<Uint8Array>,
	opts?: ReadOptions,
) {
	const osmPbfStream = await createOsmPbfReadStream(stream)
	return {
		header: osmPbfStream.header,
		readEntities: readOsmPbfPrimitiveBlocks(osmPbfStream.blocks, opts),
		stats: osmPbfStream.stats,
	}
}
