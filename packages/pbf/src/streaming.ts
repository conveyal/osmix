import Pbf from "pbf"
import { createOsmPbfBlobGenerator } from "./pbf-to-blobs"
import {
	readHeaderBlock,
	readPrimitiveBlock,
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
} from "./proto/osmformat"
import { decompress } from "./utils"
import { createOsmDataBlob, createOsmHeaderBlob } from "./blocks-to-pbf"

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
	headerPiped = false
	constructor() {
		super({
			transform: async (block, controller) => {
				if ("primitivegroup" in block) {
					if (!this.headerPiped)
						throw Error("Header first in ReadableStream of blocks.")
					controller.enqueue(await createOsmDataBlob(block))
				} else {
					this.headerPiped = true
					controller.enqueue(await createOsmHeaderBlob(block))
				}
			},
		})
	}
}
