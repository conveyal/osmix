import Pbf from "pbf"
import { writeBlob, writeBlobHeader } from "./proto/fileformat"
import {
	writeHeaderBlock,
	writePrimitiveBlock,
	type OsmPbfHeaderBlock,
	type OsmPbfPrimitiveBlock,
} from "./proto/osmformat"

/**
 * Write OSM PBF data to a stream.
 * @param stream - The stream to write the data to.
 * @param header - The OSM PBF header.
 * @param blocks - An async generator of OSM PBF primitive blocks.
 */
export async function writePbfToStream(
	stream: WritableStream<Uint8Array>,
	header: OsmPbfHeaderBlock,
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
) {
	const writer = new OsmPbfWriter(stream)
	await writer.writeHeader(header)
	for await (const block of blocks) {
		await writer.writePrimitiveBlock(block)
	}
}

/**
 * Write OSM PBF data to a stream.
 */
export class OsmPbfWriter {
	stream: WritableStream<Uint8Array>

	constructor(stream: WritableStream<Uint8Array>) {
		this.stream = stream
	}

	async writePbfData(data: Uint8Array[]) {
		const writer = this.stream.getWriter()
		await Promise.all(data.map((d) => writer.write(d)))
		writer.releaseLock()
	}

	async writeHeader(header: OsmPbfHeaderBlock) {
		await this.writePbfData(await convertHeaderToPbfData(header))
	}

	async writePrimitiveBlock(block: OsmPbfPrimitiveBlock) {
		await this.writePbfData(await convertPrimitiveBlockToPbfData(block))
	}
}

async function convertHeaderToPbfData(
	headerBlock: OsmPbfHeaderBlock,
): Promise<Uint8Array[]> {
	const contentPbf = new Pbf()
	writeHeaderBlock(headerBlock, contentPbf)
	const content = await createPbfBlob(contentPbf.finish())
	const headerPbf = new Pbf()
	writeBlobHeader(
		{
			type: "OSMHeader",
			datasize: content.length,
		},
		headerPbf,
	)
	const header = headerPbf.finish()

	return [uint32BE(header.byteLength), header, content]
}

async function convertPrimitiveBlockToPbfData(
	block: OsmPbfPrimitiveBlock,
): Promise<Uint8Array[]> {
	const blockPbf = new Pbf()
	writePrimitiveBlock(block, blockPbf)
	const content = await createPbfBlob(blockPbf.finish())

	const headerPbf = new Pbf()
	writeBlobHeader(
		{
			type: "OSMData",
			datasize: content.length,
		},
		headerPbf,
	)
	const header = headerPbf.finish()

	return [uint32BE(header.byteLength), header, content]
}

async function createPbfBlob(data: Uint8Array): Promise<Uint8Array> {
	const blobPbf = new Pbf()
	const raw_size = data.length
	const compressedBuffer = await nativeCompress(data)
	writeBlob(
		{
			raw_size,
			zlib_data: compressedBuffer,
		},
		blobPbf,
	)

	// Check if the length is greater than 32M
	if (blobPbf.length > 32 * 1024 * 1024) {
		throw new Error("Each OSM PBF blob must be less than 32MB")
	}

	return blobPbf.finish()
}

/**
 * Encode a 32-bit *big-endian* unsigned integer.
 */
function uint32BE(n: number): Uint8Array {
	const out = new Uint8Array(4)
	out[0] = (n >>> 24) & 0xff
	out[1] = (n >>> 16) & 0xff
	out[2] = (n >>> 8) & 0xff
	out[3] = n & 0xff
	return out
}

/**
 * Compress data using the native browser/runtime compression stream.
 */
function nativeCompress(data: Uint8Array) {
	const stream = new CompressionStream("deflate")
	const compressedStream = new Blob([data]).stream().pipeThrough(stream)
	return new Response(compressedStream).bytes()
}
