import Pbf from "pbf"
import {
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
	readHeaderBlock,
	readPrimitiveBlock,
} from "./proto/osmformat"
import { webDecompress } from "./utils"

/**
 * Decompresses raw OSM PBF blobs and yields typed header and primitive blocks.
 * Expects the first blob to contain the file header and streams the rest as data blocks.
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
 * Decompress and read the header block from a compressed blob.
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
 * Decompress and read the primitive block from a compressed blob.
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
