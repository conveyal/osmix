import Pbf from "pbf"
import { osmBlockToPbfBlobBytes } from "./blocks-to-pbf"
import { createOsmPbfBlobGenerator } from "./pbf-to-blobs"
import {
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
	readHeaderBlock,
	readPrimitiveBlock,
} from "./proto/osmformat"
import { decompress } from "./utils"

/**
 * Transform PBF bytes to blocks. Assumes that the first block found is the header.
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

/**
 * Transform blocks to PBF bytes. Header *must* be the first block.
 */
export class OsmBlocksToPbfBytesTransformStream extends TransformStream<
	OsmPbfHeaderBlock | OsmPbfBlock,
	Uint8Array
> {
	headerEnqueued = false
	constructor() {
		super({
			transform: async (block, controller) => {
				if ("primitivegroup" in block && !this.headerEnqueued) {
					throw Error("Header first in ReadableStream of blocks.")
				}
				this.headerEnqueued = true
				controller.enqueue(await osmBlockToPbfBlobBytes(block))
			},
		})
	}
}
