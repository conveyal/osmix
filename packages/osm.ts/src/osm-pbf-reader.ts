import Pbf from "pbf"
import { readBlob, readBlobHeader } from "./proto/fileformat"
import { readHeaderBlock, readPrimitiveBlock } from "./proto/osmformat"
import type { OsmPbfHeaderBlock, OsmPbfPrimitiveBlock } from "./types"
import { streamToAsyncIterator } from "./utils"

const HEADER_BYTES_LENGTH = 4
const State = {
	READ_HEADER_LENGTH: 0,
	READ_HEADER: 1,
	READ_BLOB: 2,
}

type HeaderType = "OSMHeader" | "OSMData"

/**
 * Read an OSM PBF from binary data and generate a header and primitive blocks from its contents.
 *
 * @param data - The binary data to read as a single chunk or a stream of chunks.
 * @returns A parsed header and a generator that yields the primitive blocks.
 */
export async function createOsmPbfReader(
	data: ReadableStream<Uint8Array> | ArrayBuffer,
) {
	const reader = createOsmPbfBlockGenerator(data)
	const header = (await reader.next()).value as OsmPbfHeaderBlock
	if (header == null) throw new Error("Header not found")
	return { header, blocks: reader as AsyncGenerator<OsmPbfPrimitiveBlock> }
}

/**
 * Create a generator that yields the header and primitive blocks from an OSM PBF.
 *
 * @param data - The binary data to read.
 * @returns A generator that yields the header and primitive blocks.
 */
async function* createOsmPbfBlockGenerator(
	data: ReadableStream<Uint8Array> | ArrayBuffer,
): AsyncGenerator<OsmPbfHeaderBlock | OsmPbfPrimitiveBlock> {
	let pbf: Pbf | null = null
	let state: number = State.READ_HEADER_LENGTH
	let bytesNeeded: number = HEADER_BYTES_LENGTH
	let headerType: HeaderType | null = null

	async function* generateBlocksFromChunk(chunk: ArrayBuffer) {
		if (pbf !== null) {
			const currentBuffer: Uint8Array = pbf.buf.slice(pbf.pos)
			const tmpBuffer = new Uint8Array(
				currentBuffer.buffer.byteLength + chunk.byteLength,
			)
			tmpBuffer.set(currentBuffer.subarray(0))
			tmpBuffer.set(new Uint8Array(chunk), currentBuffer.byteLength)
			pbf = new Pbf(tmpBuffer)
		} else {
			pbf = new Pbf(chunk)
		}

		while (pbf.pos < pbf.length) {
			if (state === State.READ_HEADER_LENGTH) {
				if (pbf.pos + bytesNeeded > pbf.length) break
				const dataView = new DataView(pbf.buf.buffer)
				bytesNeeded = dataView.getUint32(pbf.pos)
				pbf.pos += HEADER_BYTES_LENGTH
				state = State.READ_HEADER
			} else if (state === State.READ_HEADER) {
				if (pbf.pos + bytesNeeded > pbf.length) break
				const header = readBlobHeader(pbf, pbf.pos + bytesNeeded)
				bytesNeeded = header.datasize
				headerType = header.type as HeaderType
				state = State.READ_BLOB
			} else if (state === State.READ_BLOB) {
				if (pbf.pos + bytesNeeded > pbf.length) break
				if (headerType == null) throw new Error("Blob header has not been read")
				const blob = readBlob(pbf, pbf.pos + bytesNeeded)
				if (!blob.zlib_data || blob.zlib_data.length === 0)
					throw new Error("Blob has no zlib data")
				const data = await decompress(blob.zlib_data)
				const blobPbf = new Pbf(data)
				if (headerType === "OSMHeader") {
					yield readHeaderBlock(blobPbf)
				} else {
					yield readPrimitiveBlock(blobPbf)
				}
				state = State.READ_HEADER_LENGTH
				bytesNeeded = HEADER_BYTES_LENGTH
				headerType = null
			}
		}
	}

	if (data instanceof ArrayBuffer) {
		return generateBlocksFromChunk(data)
	}

	for await (const chunk of streamToAsyncIterator(data)) {
		yield* generateBlocksFromChunk(chunk.buffer as ArrayBuffer)
	}
}

/**
 * Decompress a zlib-compressed array of bytes.
 *
 * @param data - The compressed data.
 * @returns The decompressed array of bytes.
 */
function decompress(data: Uint8Array) {
	const decompressedStream = new Blob([data])
		.stream()
		.pipeThrough(new DecompressionStream("deflate"))
	return new Response(decompressedStream).bytes()
}
