import Pbf from "pbf"
import { writeBlob, writeBlobHeader } from "./proto/fileformat"
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "./proto/osmformat"
import { writeHeaderBlock, writePrimitiveBlock } from "./proto/osmformat"
import {
	MAX_BLOB_SIZE_BYTES,
	MAX_HEADER_SIZE_BYTES,
	RECOMMENDED_BLOB_SIZE_BYTES,
	RECOMMENDED_HEADER_SIZE_BYTES,
} from "./spec"
import { compress, concatUint8, uint32BE } from "./utils"

/**
 * Turn a OSM Block into a PBF Blob as bytes.
 * @param type - The type of the blob.
 * @param contentPbf - The PBF content.
 * @returns The Blob as bytes.
 */
export async function osmBlockToPbfBlobBytes(
	block: OsmPbfBlock | OsmPbfHeaderBlock,
) {
	const contentPbf = new Pbf()
	let type: "OSMHeader" | "OSMData"
	if ("primitivegroup" in block) {
		type = "OSMData"
		writePrimitiveBlock(block, contentPbf)
	} else {
		type = "OSMHeader"
		writeHeaderBlock(block, contentPbf)
	}
	const contentData = contentPbf.finish() as Uint8Array<ArrayBuffer>
	const raw_size = contentData.length
	const compressedBuffer = await compress(contentData)

	const blobPbf = new Pbf()
	writeBlob(
		{
			raw_size,
			zlib_data: compressedBuffer,
		},
		blobPbf,
	)
	const blob = blobPbf.finish()

	const blobHeaderPbf = new Pbf()
	writeBlobHeader(
		{
			type,
			datasize: blob.length,
		},
		blobHeaderPbf,
	)
	const blobHeader = blobHeaderPbf.finish()
	const blobHeaderSize = uint32BE(blobHeader.byteLength)

	// Check the BlobHeader and Blob sizes, log error if over the recommended size, throw error if over the maximum size
	if (blobHeader.byteLength > RECOMMENDED_HEADER_SIZE_BYTES) {
		const sizeKiB = (blobHeader.byteLength / 1024).toFixed(2)
		if (blobHeader.byteLength > MAX_HEADER_SIZE_BYTES) {
			throw new Error(`BlobHeader is ${sizeKiB} KiB, the maximum size is 64KiB`)
		}
		console.warn(`BlobHeader is ${sizeKiB} KiB, the recommended size is 32KiB`)
	}
	if (blob.byteLength > RECOMMENDED_BLOB_SIZE_BYTES) {
		const sizeMiB = (blob.byteLength / 1024 / 1024).toFixed(2)
		if (blob.byteLength > MAX_BLOB_SIZE_BYTES) {
			throw new Error(`Blob is ${sizeMiB} MiB, the maximum size is 32MiB`)
		}
		console.warn(`Blob is ${sizeMiB} MiB, the recommended size is 16MiB`)
	}

	return concatUint8(blobHeaderSize, blobHeader, blob)
}

/**
 * Transform a stream of OSM blocks to a stream of PBF bytes. Header *must* be the first block.
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
