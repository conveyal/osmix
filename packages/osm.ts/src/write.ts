import Pbf from "pbf"
import {
	type OsmPbfBlob,
	readBlob,
	writeBlob,
	writeBlobHeader,
} from "./proto/fileformat"
import {
	type OsmPbfChangeSet,
	type OsmPbfHeaderBlock,
	type OsmPbfNode,
	type OsmPbfPrimitiveBlock,
	type OsmPbfPrimitiveGroup,
	type OsmPbfRelation,
	type OsmPbfWay,
	writeHeaderBlock,
	writePrimitiveBlock,
} from "./proto/osmformat"
import type { OsmNode, OsmWay } from "./types"
import { nativeCompress, nativeDecompress } from "./utils"

export * from "./write-osm-pbf"

const HEADER_BYTES_LENGTH = 4

/* 
export async function createDownloadUrlForPbf(
	fileName: string,
	header: OsmPbfHeaderBlock,
	blocks: OsmPbfPrimitiveBlock[],
) {
	// create a new handle
	const newHandle = await window.showSaveFilePicker()

	// create a FileSystemWritableFileStream to write to
	const writableStream = await newHandle.createWritable()
	await writePbfToStream(writableStream, header, blocks)
	const blob = new Blob(newHandle, { type: "application/octet-stream" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
}
*/

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
	blocks: OsmPbfPrimitiveBlock[],
) {
	const writer = stream.getWriter()
	for await (const blobs of generatePbfs(header, blocks)) {
		const headerBuffer = blobs.header.finish()
		const length = headerBuffer.byteLength

		writer.write(uint32BE(length))
		writer.write(headerBuffer)
		writer.write(blobs.content.finish())
	}
	writer.close()
}

const MAX_ENTITIES_PER_BLOCK = 8_000

class PrimitiveGroup implements OsmPbfPrimitiveGroup {
	nodes: OsmPbfNode[] = []
	ways: OsmPbfWay[] = []
	relations: OsmPbfRelation[] = []
	changesets: OsmPbfChangeSet[] = []
}

class PrimitiveBlock implements OsmPbfPrimitiveBlock {
	stringtable: string[] = [""]
	primitivegroup: OsmPbfPrimitiveGroup[] = []

	#entities = 0

	constructor() {
		this.addGroup()
	}

	addGroup() {
		this.primitivegroup.push(new PrimitiveGroup())
	}

	isFull() {
		return this.#entities >= MAX_ENTITIES_PER_BLOCK
	}

	get group() {
		const g = this.primitivegroup[this.primitivegroup.length - 1]
		if (g == null) throw new Error("No group found")
		return g
	}

	addTags(tags: Record<string, string>) {
		const keys = []
		const vals = []
		for (const [key, val] of Object.entries(tags)) {
			let keyIndex = this.stringtable.findIndex((t) => t === key)
			let valIndex = this.stringtable.findIndex((t) => t === val)
			if (keyIndex === -1) {
				this.stringtable.push(key)
				keyIndex = this.stringtable.length - 1
			}
			if (valIndex === -1) {
				this.stringtable.push(val)
				valIndex = this.stringtable.length - 1
			}
			keys.push(keyIndex)
			vals.push(valIndex)
		}
		return { keys, vals }
	}

	addNode(node: OsmNode) {
		const tags = this.addTags(node.tags ?? {})
		this.group.nodes.push({
			...node,
			keys: tags.keys,
			vals: tags.vals,
		})
		this.#entities++
	}

	addWay(way: OsmWay) {
		const tags = this.addTags(way.tags ?? {})
		this.group.ways.push({
			...way,
			keys: tags.keys,
			vals: tags.vals,
			lat: [],
			lon: [],
		})
		this.#entities++
	}
}

/**
 * Convert an OSM object to a list of primitive blocks.
 *
 * TODO: Sort nodes and ways?
 * TODO: Add support for relations
 * TODO: Add support for dense nodes
 * @param osm - The OSM object to convert
 * @returns a generator that produces primitive blocks
 */
export async function* osmToPrimitiveBlocks(osm: {
	nodes: OsmNode[]
	ways: OsmWay[]
}): AsyncGenerator<OsmPbfPrimitiveBlock> {
	let block = new PrimitiveBlock()
	for (const node of osm.nodes) {
		if (block.isFull()) {
			yield block
			block = new PrimitiveBlock()
		}
		block.addNode(node)
	}

	// Primitive groups only have one type of entity
	block.addGroup()

	for (const way of osm.ways) {
		if (block.isFull()) {
			yield block
			block = new PrimitiveBlock()
		}
		block.addWay(way)
	}

	yield block
}

export async function* generatePbfs(
	header: OsmPbfHeaderBlock,
	blocks: OsmPbfPrimitiveBlock[],
): AsyncGenerator<{ header: Pbf; content: Pbf }> {
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

	yield { header: osmHeaderBlobHeader, content: osmHeaderBlob }
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
		yield { header: osmDataBlobHeader, content: osmDataBlob }
	}
}

async function createBlobPbf(
	data: Uint8Array,
	compression: OsmPbfBlob["data"] = "zlib_data",
): Promise<Pbf> {
	const blobPbf = new Pbf()
	const raw_size = data.length

	if (compression === "zlib_data") {
		const compressedBuffer = await nativeCompress(data)
		writeBlob(
			{
				zlib_data: compressedBuffer,
				raw_size,
			},
			blobPbf,
		)
		const blob = readBlob(blobPbf)
		if (!blob.zlib_data) {
			console.error(blob)
			throw new Error("No zlib data")
		}
		const uncompressedData = await nativeDecompress(blob.zlib_data)
		console.assert(uncompressedData.length === data.length)
		console.log("Uncompressed data works")
	} else if (compression === "raw") {
		writeBlob(
			{
				raw: data,
				raw_size,
			},
			blobPbf,
		)
	} else {
		throw new Error(`Unknown compression: ${compression}`)
	}

	// Check if the length is greater than 32M
	if (blobPbf.length > 32 * 1024 * 1024) {
		throw new Error("Each OSM PBF blob must be less than 32MB")
	}

	return blobPbf
}
