import Pbf from "pbf"
import { readBlob, readBlobHeader } from "./proto/fileformat"
import {
	readHeaderBlock,
	readPrimitiveBlock,
	type OsmPbfHeaderBlock,
	type OsmPbfPrimitiveBlock,
} from "./proto/osmformat"
import { nativeDecompress, streamToAsyncIterator } from "./utils"

const HEADER_BYTES_LENGTH = 4
const State = {
	READ_HEADER_LENGTH: 0,
	READ_HEADER: 1,
	READ_BLOB: 2,
}

type HeaderType = "OSMHeader" | "OSMData"

export class OsmPbfReader {
	header: OsmPbfHeaderBlock
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>

	/**
	 * Create an `OsmPbfReader` from binary data. Automatically parse the header and allow user to stream blocks from its contents.
	 */
	static async from(data: ReadableStream<Uint8Array> | ArrayBuffer) {
		const reader = createOsmPbfBlockGenerator(data)
		const header = (await reader.next()).value as OsmPbfHeaderBlock
		if (header == null) throw new Error("Header not found")
		return new OsmPbfReader(
			header,
			reader as AsyncGenerator<OsmPbfPrimitiveBlock>,
		)
	}

	constructor(
		header: OsmPbfHeaderBlock,
		blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
	) {
		this.header = header
		this.blocks = blocks
	}
}

/**
 * Create a generator that yields the header and primitive blocks from a PBF binary data.
 *
 * @param data - The binary data to read.
 * @returns A generator that yields the header and primitive blocks.
 */
export async function* createOsmPbfBlockGenerator(
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
				const data = await nativeDecompress(blob.zlib_data)
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
		yield* generateBlocksFromChunk(data)
	} else {
		for await (const chunk of streamToAsyncIterator(data)) {
			yield* generateBlocksFromChunk(chunk.buffer as ArrayBuffer)
		}
	}
}
