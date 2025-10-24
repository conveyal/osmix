import Pbf from "pbf"
import { readHeaderBlock, readPrimitiveBlock } from "./proto/osmformat"
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
		const decompressedBlob = await decompress(blob)
		const pbf = new Pbf(decompressedBlob)
		if (!headerRead) {
			headerRead = true
			yield readHeaderBlock(pbf)
		} else {
			yield readPrimitiveBlock(pbf)
		}
	}
}
