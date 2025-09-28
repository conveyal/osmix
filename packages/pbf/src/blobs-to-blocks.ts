import Pbf from "pbf"
import { readHeaderBlock, readPrimitiveBlock } from "./proto/osmformat"
import { decompress } from "./utils"

/**
 * Helper to turn a generator of compressed Blob data into a generator of decompressed and parsed header and primitive blocks.
 */
export async function* osmPbfBlobsToBlocksGenerator(
	blobs: AsyncGenerator<Uint8Array> | Generator<Uint8Array>,
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
