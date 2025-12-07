/**
 * Block-to-PBF serialization utilities.
 *
 * Converts parsed OSM header and primitive blocks back into spec-compliant
 * PBF byte sequences with proper framing, compression, and size validation.
 *
 * @module
 */

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
import { concatUint8, uint32BE, webCompress } from "./utils"

/**
 * Serialize a header or primitive block into spec-compliant PBF bytes.
 *
 * Handles protobuf encoding, zlib compression, blob wrapping, and length prefixing.
 * Validates output against OSM PBF specification size limits and logs warnings
 * if recommended sizes are exceeded.
 *
 * @param block - Parsed header or primitive block to encode.
 * @param compress - Optional compression function (defaults to Web Streams zlib).
 * @returns Complete blob bytes: 4-byte length prefix + BlobHeader + Blob.
 * @throws If blob exceeds maximum size limits (64 KiB header, 32 MiB data).
 *
 * @example
 * ```ts
 * import { osmBlockToPbfBlobBytes } from "@osmix/pbf"
 *
 * const headerBytes = await osmBlockToPbfBlobBytes({
 *   required_features: ["OsmSchema-V0.6", "DenseNodes"],
 *   optional_features: [],
 * })
 * ```
 */
export async function osmBlockToPbfBlobBytes(
	block: OsmPbfBlock | OsmPbfHeaderBlock,
	compress: (
		data: Uint8Array<ArrayBuffer>,
	) => Promise<Uint8Array<ArrayBuffer>> = webCompress,
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
 * Web `TransformStream` that encodes OSM blocks into PBF byte chunks.
 *
 * Accepts a stream of header and primitive blocks and outputs spec-compliant
 * PBF bytes. The header block must be the first item in the stream.
 *
 * @throws If a primitive block is received before the header.
 *
 * @example
 * ```ts
 * import { OsmBlocksToPbfBytesTransformStream } from "@osmix/pbf"
 *
 * const pbfStream = blocksStream.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
 * await pbfStream.pipeTo(writableFile)
 * ```
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
