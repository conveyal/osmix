import Pbf from "pbf"
import { readBlob, readBlobHeader } from "./proto/fileformat"
import {
	type OsmPbfHeaderBlock,
	type OsmPbfPrimitiveBlock,
	readHeaderBlock,
	readPrimitiveBlock,
} from "./proto/osmformat"
import type { OsmReadStats } from "./types"
import { nativeDecompress, streamToAsyncIterator } from "./utils"

const HEADER_BYTES_LENGTH = 4
const State = {
	READ_HEADER_LENGTH: 0,
	READ_HEADER: 1,
	READ_BLOB: 2,
}

type HeaderType = "OSMHeader" | "OSMData"

/**
 * Read an OSM PBF stream. Returns the parsed header and an async generator which yields decompressed primitive blocks.
 * @param chunks - A ReadableStream of binary data, usually from a file.
 * @param decompress - A function to decompress the data.
 * @returns An async generator of OSM PBF header and primitive blocks.
 */
export async function pbfToBlocks(
	chunks: ReadableStream<Uint8Array>,
	decompress: (data: Uint8Array) => Promise<Uint8Array> = nativeDecompress,
): Promise<{
	header: OsmPbfHeaderBlock
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>
	stats: OsmReadStats
}> {
	let pbf: Pbf | null = null
	let state = State.READ_HEADER_LENGTH
	let bytesNeeded = HEADER_BYTES_LENGTH
	let headerType: HeaderType | null = null

	const stats = {
		blocks: 0,
		chunks: 0,
		inflateMs: 0,
		inflateBytes: 0,
	}

	async function* readBlocks() {
		for await (const chunk of streamToAsyncIterator(chunks)) {
			stats.chunks++

			if (pbf !== null) {
				const currentBuffer: Uint8Array = pbf.buf.slice(pbf.pos)
				const tmpBuffer = new Uint8Array(
					currentBuffer.buffer.byteLength + chunk.byteLength,
				)
				tmpBuffer.set(currentBuffer.subarray(0))
				tmpBuffer.set(chunk, currentBuffer.byteLength)
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
					if (headerType == null)
						throw new Error("Blob header has not been read")
					const blob = readBlob(pbf, pbf.pos + bytesNeeded)
					if (!blob.zlib_data || blob.zlib_data.length === 0)
						throw new Error("Blob has no zlib data")

					const start = performance.now()
					const data = await decompress(blob.zlib_data)
					stats.inflateMs += performance.now() - start
					stats.inflateBytes += data.byteLength

					const blobPbf = new Pbf(data)
					if (headerType === "OSMHeader") {
						yield readHeaderBlock(blobPbf)
					} else {
						stats.blocks++
						yield readPrimitiveBlock(blobPbf)
					}
					state = State.READ_HEADER_LENGTH
					bytesNeeded = HEADER_BYTES_LENGTH
					headerType = null
				}
			}
		}
	}

	const reader = readBlocks()
	const header = (await reader.next()).value as OsmPbfHeaderBlock
	if (header == null) throw new Error("Header not found")

	return {
		header,
		blocks: reader as AsyncGenerator<OsmPbfPrimitiveBlock>,
		stats,
	}
}
