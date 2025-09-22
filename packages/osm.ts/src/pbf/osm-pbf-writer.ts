import Pbf from "pbf"
import { MAX_BLOB_SIZE_BYTES } from "./constants"
import { writeBlob, writeBlobHeader } from "./proto/fileformat"
import {
	type OsmPbfHeaderBlock,
	type OsmPbfPrimitiveBlock,
	writeHeaderBlock,
	writePrimitiveBlock,
} from "./proto/osmformat"
import { nativeCompress, uint32BE } from "./utils"

/**
 * Write OSM PBF data to a stream.
 * @param stream - The stream to write the data to.
 * @param header - The OSM PBF header.
 * @param blocks - An async generator of OSM PBF primitive blocks.
 */
export async function writePbfToStream(
	stream: WritableStream<Uint8Array>,
	header: OsmPbfHeaderBlock,
	blocks:
		| AsyncGenerator<OsmPbfPrimitiveBlock>
		| Generator<OsmPbfPrimitiveBlock>,
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
	writer: WritableStreamDefaultWriter<Uint8Array>

	constructor(stream: WritableStream<Uint8Array>) {
		this.stream = stream
		this.writer = stream.getWriter()
	}

	private async writePbfData(
		type: "OSMHeader" | "OSMData",
		writeContent: (pbf: Pbf) => void,
	) {
		const contentPbf = new Pbf()
		writeContent(contentPbf)
		const blobPbf = new Pbf()
		const contentData = contentPbf.finish()
		const raw_size = contentData.length
		const compressedBuffer = await nativeCompress(contentData)
		writeBlob(
			{
				raw_size,
				zlib_data: compressedBuffer,
			},
			blobPbf,
		)

		// Check if the length is greater than 32M
		if (blobPbf.length > MAX_BLOB_SIZE_BYTES) {
			throw new Error("Each OSM PBF blob must be less than 32MB")
		}
		const content = blobPbf.finish()
		const headerPbf = new Pbf()
		writeBlobHeader(
			{
				type,
				datasize: content.length,
			},
			headerPbf,
		)
		const header = headerPbf.finish()
		await this.writer.write(uint32BE(header.byteLength))
		await this.writer.write(header)
		await this.writer.write(content)
	}

	async close() {
		this.writer.releaseLock()
		await this.stream.close()
	}

	writeHeader(headerBlock: OsmPbfHeaderBlock) {
		return this.writePbfData("OSMHeader", (pbf) =>
			writeHeaderBlock(headerBlock, pbf),
		)
	}

	async writePrimitiveBlock(primitiveBlock: OsmPbfPrimitiveBlock) {
		return this.writePbfData("OSMData", (pbf) =>
			writePrimitiveBlock(primitiveBlock, pbf),
		)
	}
}
