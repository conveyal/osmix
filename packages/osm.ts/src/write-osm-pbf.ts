import Pbf from "pbf"
import type { Osm } from "./osm"
import { OsmPrimitiveBlock } from "./osm-primitive-block"
import { writeBlob, writeBlobHeader } from "./proto/fileformat"
import { writeHeaderBlock, writePrimitiveBlock } from "./proto/osmformat"
import type { OsmPbfHeaderBlock, OsmPbfPrimitiveBlock } from "./types"
import { nativeCompress } from "./utils"

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

export async function writePbfToStream(
	stream: WritableStream<Uint8Array>,
	header: OsmPbfHeaderBlock,
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
) {
	const writer = stream.getWriter()
	for await (const blob of generatePbfs(header, blocks)) {
		const length = blob.header.byteLength

		writer.write(uint32BE(length))
		writer.write(blob.header)
		writer.write(blob.content)
	}
	writer.releaseLock()
}

/**
 * Convert an OSM object to a list of primitive blocks.
 *
 * TODO: Sort nodes and ways?
 * TODO: Add support for dense nodes
 * @param osm - The OSM object to convert
 * @returns a generator that produces primitive blocks
 */
export async function* osmToPrimitiveBlocks(
	osm: Osm,
): AsyncGenerator<OsmPbfPrimitiveBlock> {
	let block = new OsmPrimitiveBlock()
	for (const node of osm.nodes.values()) {
		if (block.isFull()) {
			yield block
			block = new OsmPrimitiveBlock()
		}
		block.addNode(node)
	}

	// Primitive groups only have one type of entity
	block.addGroup()

	for (const way of osm.ways.values()) {
		if (block.isFull()) {
			yield block
			block = new OsmPrimitiveBlock()
		}
		block.addWay(way)
	}

	block.addGroup()

	for (const relation of osm.relations.values()) {
		if (block.isFull()) {
			yield block
			block = new OsmPrimitiveBlock()
		}
		block.addRelation(relation)
	}

	yield block
}

async function* generatePbfs(
	header: OsmPbfHeaderBlock,
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
): AsyncGenerator<{ header: Uint8Array; content: Uint8Array }> {
	const osmHeader = new Pbf()
	writeHeaderBlock(header, osmHeader)
	const osmHeaderBlob = await createBlobPbf(osmHeader.finish())
	const osmHeaderBlobHeader = new Pbf()
	writeBlobHeader(
		{
			type: "OSMHeader",
			datasize: osmHeaderBlob.length,
		},
		osmHeaderBlobHeader,
	)

	yield { header: osmHeaderBlobHeader.finish(), content: osmHeaderBlob }
	for await (const block of blocks) {
		const blockPbf = new Pbf()
		writePrimitiveBlock(block, blockPbf)
		const osmDataBlob = await createBlobPbf(blockPbf.finish())
		const osmDataBlobHeader = new Pbf()
		writeBlobHeader(
			{
				type: "OSMData",
				datasize: osmDataBlob.length,
			},
			osmDataBlobHeader,
		)
		yield { header: osmDataBlobHeader.finish(), content: osmDataBlob }
	}
}

async function createBlobPbf(data: Uint8Array): Promise<Uint8Array> {
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
