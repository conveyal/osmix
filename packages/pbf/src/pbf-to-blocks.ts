import { osmPbfBlobsToBlocksGenerator } from "./blobs-to-blocks"
import { createOsmPbfBlobGenerator } from "./pbf-to-blobs"
import type { OsmPbfBlock } from "./proto/osmformat"
import { toAsyncGenerator } from "./utils"

export const HEADER_LENGTH_BYTES = 4

/**
 * Create an OSM PBF reader from binary data.
 */
export async function createOsmPbfReader(
	data: Uint8Array | ReadableStream<Uint8Array>,
) {
	const generateBlobsFromChunk = createOsmPbfBlobGenerator()
	const blocks = osmPbfBlobsToBlocksGenerator(
		(async function* () {
			for await (const chunk of toAsyncGenerator(data)) {
				for await (const blob of generateBlobsFromChunk(chunk)) {
					yield blob
				}
			}
		})(),
	)
	const header = (await blocks.next()).value
	if (header == null || !("required_features" in header)) {
		throw Error("OSM PBF header block not found")
	}
	return {
		header,
		blocks: blocks as AsyncGenerator<OsmPbfBlock>,
	}
}
