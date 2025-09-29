import Pbf from "pbf"
import { osmPbfBlobsToBlocksGenerator } from "./blobs-to-blocks"
import { createOsmPbfBlobGenerator } from "./pbf-to-blobs"
import {
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
	readHeaderBlock,
	readPrimitiveBlock,
} from "./proto/osmformat"
import { decompress } from "./utils"

export const HEADER_LENGTH_BYTES = 4

/**
 * Create an OSM PBF reader from binary data.
 */
export async function readOsmPbf(data: Uint8Array) {
	const generateBlobsFromChunk = createOsmPbfBlobGenerator()
	const blobs = generateBlobsFromChunk(data)
	const blocks = osmPbfBlobsToBlocksGenerator(blobs)
	const header = (await blocks.next()).value
	if (header == null || !("required_features" in header)) {
		throw Error("OSM PBF header block not found")
	}
	return {
		header,
		blocks: blocks as AsyncGenerator<OsmPbfBlock>,
	}
}

/**
 * Transform a stream of PBF bytes to a stream of OSM blocks. Assumes that the first block is the header.
 */
export class OsmPbfBytesToBlocksTransformStream extends TransformStream<
	Uint8Array,
	OsmPbfHeaderBlock | OsmPbfBlock
> {
	generateBlobsFromChunk = createOsmPbfBlobGenerator()
	header: OsmPbfHeaderBlock | null = null
	constructor() {
		super({
			transform: async (bytesChunk, controller) => {
				for await (const rawBlobs of this.generateBlobsFromChunk(bytesChunk)) {
					const decompressed = await decompress(rawBlobs)
					const pbf = new Pbf(decompressed)
					if (this.header == null) {
						this.header = readHeaderBlock(pbf)
						controller.enqueue(this.header)
					} else {
						controller.enqueue(readPrimitiveBlock(pbf))
					}
				}
			},
		})
	}
}
