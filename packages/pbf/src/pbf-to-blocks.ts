import Pbf from "pbf"
import { osmPbfBlobsToBlocksGenerator } from "./blobs-to-blocks"
import { createOsmPbfBlobGenerator } from "./pbf-to-blobs"
import {
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
	readHeaderBlock,
	readPrimitiveBlock,
} from "./proto/osmformat"
import {
	type AsyncGeneratorValue,
	toAsyncGenerator,
	webDecompress,
} from "./utils"

export const HEADER_LENGTH_BYTES = 4

/**
 * Parses OSM PBF bytes from buffers, streams, or generators into header + block iterators.
 * Returns the decoded header and a lazy async generator of primitive blocks.
 */
export async function readOsmPbf(data: AsyncGeneratorValue<ArrayBufferLike>) {
	const generateBlobsFromChunk = createOsmPbfBlobGenerator()
	const blocks = osmPbfBlobsToBlocksGenerator(
		(async function* () {
			for await (const chunk of toAsyncGenerator(data)) {
				for await (const blob of generateBlobsFromChunk(
					new Uint8Array(chunk),
				)) {
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

/**
 * Web `TransformStream` that turns raw PBF byte chunks into OSM header/data blocks.
 * Assumes the first decoded blob carries the header and emits it before any primitive blocks.
 */
export class OsmPbfBytesToBlocksTransformStream extends TransformStream<
	ArrayBufferLike,
	OsmPbfHeaderBlock | OsmPbfBlock
> {
	generateBlobsFromChunk = createOsmPbfBlobGenerator()
	header: OsmPbfHeaderBlock | null = null
	constructor(
		decompress: (
			data: Uint8Array<ArrayBuffer>,
		) => Promise<Uint8Array<ArrayBuffer>> = webDecompress,
	) {
		super({
			transform: async (bytesChunk, controller) => {
				for await (const rawBlobs of this.generateBlobsFromChunk(
					new Uint8Array(bytesChunk),
				)) {
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
