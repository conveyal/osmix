import Pbf from "pbf"
import { writeBlob, writeBlobHeader } from "./proto/fileformat"
import {
	type OsmPbfDenseNodes,
	type OsmPbfHeaderBlock,
	type OsmPbfNode,
	type OsmPbfPrimitiveBlock,
	type OsmPbfPrimitiveGroup,
	type OsmPbfRelation,
	type OsmPbfWay,
	writeHeaderBlock,
	writePrimitiveBlock,
} from "./proto/osmformat"
import { MEMBER_TYPES } from "./read-osm-pbf"
import type { OsmNode, OsmRelation, OsmWay } from "./types"
import { nativeCompress } from "./utils"

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
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
) {
	const writer = stream.getWriter()
	for await (const blob of generatePbfs(header, blocks)) {
		const length = blob.header.byteLength

		writer.write(uint32BE(length))
		writer.write(blob.header)
		writer.write(blob.content)
	}
	writer.close()
}

const MAX_ENTITIES_PER_BLOCK = 8_000

class PrimitiveGroup implements OsmPbfPrimitiveGroup {
	dense?: OsmPbfDenseNodes
	nodes: OsmPbfNode[] = []
	ways: OsmPbfWay[] = []
	relations: OsmPbfRelation[] = []
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

	getStringtableIndex(key: string) {
		let index = this.stringtable.findIndex((t) => t === key)
		if (index === -1) {
			this.stringtable.push(key)
			index = this.stringtable.length - 1
		}
		return index
	}

	addTags(tags: Record<string, string>) {
		const keys = []
		const vals = []
		for (const [key, val] of Object.entries(tags)) {
			keys.push(this.getStringtableIndex(key))
			vals.push(this.getStringtableIndex(val))
		}
		return { keys, vals }
	}

	addDenseNode(node: OsmNode) {
		const tags = this.addTags(node.tags ?? {})
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
		let lastRef = 0
		const refs = way.refs.map((ref) => {
			const delta = ref - lastRef
			lastRef = ref
			return delta
		})
		const tags = this.addTags(way.tags ?? {})
		this.group.ways.push({
			...way,
			refs,
			keys: tags.keys,
			vals: tags.vals,
		})
		this.#entities++
	}

	addRelation(relation: OsmRelation) {
		const memids: number[] = []
		const roles_sid: number[] = []
		const types: number[] = []

		// Delta code the memids
		let lastMemId = 0
		for (const member of relation.members) {
			memids.push(member.ref - lastMemId)
			lastMemId = member.ref
			roles_sid.push(this.getStringtableIndex(member.role ?? ""))
			types.push(MEMBER_TYPES.indexOf(member.type))
		}

		const tags = this.addTags(relation.tags ?? {})
		this.group.relations.push({
			...relation,
			keys: tags.keys,
			vals: tags.vals,
			memids,
			roles_sid,
			types,
		})
	}
}

/**
 * Convert an OSM object to a list of primitive blocks.
 *
 * TODO: Sort nodes and ways?
 * TODO: Add support for dense nodes
 * @param osm - The OSM object to convert
 * @returns a generator that produces primitive blocks
 */
export async function* osmToPrimitiveBlocks(osm: {
	nodes: OsmNode[]
	ways: OsmWay[]
	relations: OsmRelation[]
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

	block.addGroup()

	for (const relation of osm.relations) {
		if (block.isFull()) {
			yield block
			block = new PrimitiveBlock()
		}
		block.addRelation(relation)
	}

	yield block
}

export async function* generatePbfs(
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
