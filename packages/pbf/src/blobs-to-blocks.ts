/**
 * Blob-to-block conversion utilities.
 *
 * Handles decompression and protobuf decoding of raw OSM PBF blobs into
 * typed header and primitive block structures.
 *
 * @module
 */

import Pbf from "pbf"
import {
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
	readHeaderBlock,
	readPrimitiveBlock,
} from "./proto/osmformat"
import { webDecompress } from "./utils"

/**
 * Decompress and decode a stream of raw PBF blobs into typed blocks.
 *
 * This async generator handles the transition from compressed bytes to parsed
 * protobuf structures. The first blob is always decoded as a header block;
 * subsequent blobs are decoded as primitive blocks containing OSM entities.
 *
 * @param blobs - Async or sync generator yielding compressed blob payloads.
 * @param decompress - Optional decompression function (defaults to Web Streams zlib).
 * @yields Header block first, then primitive blocks.
 *
 * @example
 * ```ts
 * import { osmPbfBlobsToBlocksGenerator, createOsmPbfBlobGenerator } from "@osmix/pbf"
 *
 * const generateBlobs = createOsmPbfBlobGenerator()
 * const blobsGen = (async function* () {
 *   for await (const chunk of stream) {
 *     yield* generateBlobs(chunk)
 *   }
 * })()
 *
 * for await (const block of osmPbfBlobsToBlocksGenerator(blobsGen)) {
 *   // First iteration yields header, rest yield primitive blocks
 * }
 * ```
 */
export async function* osmPbfBlobsToBlocksGenerator(
	blobs:
		| AsyncGenerator<Uint8Array<ArrayBuffer>>
		| Generator<Uint8Array<ArrayBuffer>>,
	decompress: (
		data: Uint8Array<ArrayBuffer>,
	) => Promise<Uint8Array<ArrayBuffer>> = webDecompress,
) {
	let headerRead = false
	for await (const blob of blobs) {
		if (!headerRead) {
			headerRead = true
			yield readOsmHeaderBlock(blob, decompress)
		} else {
			yield readOsmPrimitiveBlock(blob, decompress)
		}
	}
}

/**
 * Decompress and parse a header block from a compressed blob.
 *
 * @param compressedBlob - Zlib-compressed protobuf header blob.
 * @param decompress - Optional decompression function.
 * @returns Parsed header block with required/optional features and bbox.
 */
export async function readOsmHeaderBlock(
	compressedBlob: Uint8Array<ArrayBuffer>,
	decompress: (
		data: Uint8Array<ArrayBuffer>,
	) => Promise<Uint8Array<ArrayBuffer>> = webDecompress,
): Promise<OsmPbfHeaderBlock> {
	const decompressedBlob = await decompress(compressedBlob)
	const pbf = new Pbf(decompressedBlob)
	return readHeaderBlock(pbf)
}

/**
 * Decompress and parse a primitive block from a compressed blob.
 *
 * @param compressedBlob - Zlib-compressed protobuf primitive blob.
 * @param decompress - Optional decompression function.
 * @returns Parsed primitive block with string table and primitive groups.
 */
export async function readOsmPrimitiveBlock(
	compressedBlob: Uint8Array<ArrayBuffer>,
	decompress: (
		data: Uint8Array<ArrayBuffer>,
	) => Promise<Uint8Array<ArrayBuffer>> = webDecompress,
): Promise<OsmPbfBlock> {
	const decompressedBlob = await decompress(compressedBlob)
	const pbf = new Pbf(decompressedBlob)
	return readPrimitiveBlock(pbf)
}
