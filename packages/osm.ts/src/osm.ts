import { bbox } from "@turf/turf"
import { NodeIndex, type NodeIndexTransferables } from "./node-index"
import { createOsmPbfReader } from "./pbf/osm-pbf-reader"
import { OsmPbfWriter } from "./pbf/osm-pbf-writer"
import {
	MAX_ENTITIES_PER_BLOCK,
	PrimitiveBlockBuilder,
} from "./pbf/primitive-block-builder"
import type {
	OsmPbfHeaderBlock,
	OsmPbfPrimitiveBlock,
} from "./pbf/proto/osmformat"
import { Bitmap } from "./raster"
import {
	RelationIndex,
	type RelationIndexTransferables,
} from "./relation-index"
import StringTable, { type StringTableTransferables } from "./stringtable"
import {
	nodeToFeature,
	nodesToFeatures,
	relationToFeature,
	wayToFeature,
	waysToFeatures,
} from "./to-geojson"
import type {
	GeoBbox2D,
	LonLat,
	OsmEntity,
	OsmEntityType,
	OsmEntityTypeMap,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./types"
import { isNode, isRelation, isWay, throttle } from "./utils"
import { WayIndex, type WayIndexTransferables } from "./way-index"
import Changeset from "./changeset"

export interface OsmTransferables {
	header: OsmPbfHeaderBlock
	stringTable: StringTableTransferables
	nodes: NodeIndexTransferables
	ways: WayIndexTransferables
	relations: RelationIndexTransferables
	parsingTimeMs: number
}

/**
 * Requires sorted IDs.
 */
export class Osm {
	header: OsmPbfHeaderBlock
	blocksGenerator: AsyncGenerator<OsmPbfPrimitiveBlock> | null = null

	// Shared string lookup table for all nodes, ways, and relations
	stringTable: StringTable = new StringTable()
	nodes: NodeIndex = new NodeIndex(this.stringTable)
	ways: WayIndex = new WayIndex(this.stringTable, this.nodes)
	relations: RelationIndex = new RelationIndex(this.stringTable)

	#finished = false
	parsingTimeMs = 0

	static from({
		header,
		stringTable,
		nodes,
		ways,
		relations,
		parsingTimeMs,
	}: OsmTransferables) {
		const osm = new Osm(header)
		osm.stringTable = StringTable.from(stringTable)
		osm.nodes = NodeIndex.from(osm.stringTable, nodes)
		osm.ways = WayIndex.from(osm.stringTable, osm.nodes, ways)
		osm.relations = RelationIndex.from(osm.stringTable, relations)
		osm.parsingTimeMs = parsingTimeMs
		osm.#finished = true
		return osm
	}

	static async fromPbfData(data: ArrayBuffer | ReadableStream<Uint8Array>) {
		const osm = new Osm()
		await osm.initFromPbfData(data, console.log)
		return osm
	}

	constructor(header?: OsmPbfHeaderBlock) {
		this.header = header ?? {
			required_features: [],
			optional_features: [],
		}
	}

	async initFromPbfData(
		data: ArrayBuffer | ReadableStream<Uint8Array>,
		onProgress: (...args: string[]) => void,
	) {
		const start = performance.now()
		const reader = await createOsmPbfReader(data)
		this.header = reader.header

		const logEverySecond = throttle(onProgress, 1_000)

		let entityCount = 0
		let stage: "nodes" | "ways" | "relations" = "nodes"
		for await (const block of reader.blocks) {
			const blockStringIndexMap = this.stringTable.createBlockIndexMap(block)
			for (const { nodes, ways, relations, dense } of block.primitivegroup) {
				if (dense) {
					this.nodes.addDenseNodes(dense, block, blockStringIndexMap)
					entityCount += dense.id.length
				}

				if (nodes.length > 0) {
					for (const node of nodes) {
						this.nodes.addNode(node)
					}
					entityCount += nodes.length
				}

				if (ways.length > 0) {
					if (stage === "nodes") {
						onProgress(
							`Loaded ${this.nodes.size.toLocaleString()} nodes. Building node spatial index...`,
						)
						this.nodes.finish()
						stage = "ways"
						entityCount = 0
					}
					this.ways.addWays(ways, blockStringIndexMap)
					entityCount += ways.length
				}

				if (relations.length > 0) {
					if (stage === "ways") {
						onProgress(
							`Loaded ${this.ways.size.toLocaleString()} ways. Building way spatial index...`,
						)
						this.ways.finish()
						stage = "relations"
						entityCount = 0
					}
					this.relations.addRelations(relations, blockStringIndexMap)
					entityCount += relations.length
				}

				logEverySecond(`${entityCount.toLocaleString()} ${stage} loaded`)
			}
		}
		this.finish()
		onProgress(
			`Added ${this.nodes.size.toLocaleString()} nodes, ${this.ways.size.toLocaleString()} ways, and ${this.relations.size.toLocaleString()} relations.`,
		)
		this.parsingTimeMs = performance.now() - start
	}

	finish() {
		if (!this.nodes.isReady) this.nodes.finish()
		if (!this.ways.isReady) this.ways.finish()
		if (!this.relations.isReady) this.relations.finish()
		this.stringTable.compact()
		this.#finished = true
	}

	isFinished() {
		return this.#finished
	}

	transferables(): OsmTransferables {
		return {
			header: this.header,
			stringTable: this.stringTable.transferables(),
			nodes: this.nodes.transferables(),
			ways: this.ways.transferables(),
			relations: this.relations.transferables(),
			parsingTimeMs: this.parsingTimeMs,
		}
	}

	*[Symbol.iterator]() {
		yield* this.nodes
		yield* this.ways
		yield* this.relations
	}

	get<T extends OsmEntityType>(
		type: T,
		id: number,
	): OsmEntityTypeMap[T] | undefined {
		if (type === "node") return this.nodes.get({ id }) as OsmEntityTypeMap[T]
		if (type === "way") return this.ways.get({ id }) as OsmEntityTypeMap[T]
		if (type === "relation")
			return this.relations.get({ id }) as OsmEntityTypeMap[T]
	}

	getNodesInBbox(bbox: GeoBbox2D) {
		if (!this.#finished) throw new Error("Osm not finished")
		console.time("Osm.getNodesInBbox")
		const nodeCandidates = this.nodes.withinBbox(bbox)
		const nodePositions = new Float64Array(nodeCandidates.length * 2)
		const nodeIndexes = new Uint32Array(nodeCandidates.length)
		let pIndex = 0
		for (const nodeIndex of nodeCandidates) {
			// Skip nodes with no tags, likely just a way node
			if (!this.nodes.tags.hasTags(nodeIndex)) continue

			const [lon, lat] = this.nodes.getNodeLonLat({ index: nodeIndex })
			nodeIndexes[pIndex] = nodeIndex
			nodePositions[pIndex++] = lon
			nodePositions[pIndex++] = lat
		}
		console.timeEnd("Osm.getNodesInBbox")
		return {
			indexes: nodeIndexes,
			positions: nodePositions,
		}
	}

	getWaysInBbox(bbox: GeoBbox2D) {
		console.time("Osm.getWaysInBbox")
		const wayCandidates = this.ways.intersects(bbox)
		const wayIndexes = new Uint32Array(wayCandidates.length)
		const wayPositions: Float64Array[] = []
		const wayStartIndices = new Uint32Array(wayCandidates.length + 1)
		wayStartIndices[0] = 0

		console.time("Osm.getWaysInBbox.loop")
		let size = 0
		wayCandidates.forEach((w, i) => {
			wayIndexes[i] = w
			const way = this.ways.getLine(w)
			size += way.length
			wayPositions.push(way)
			const prevIndex = wayStartIndices[i]
			if (prevIndex === undefined) throw Error("Previous index is undefined")
			wayStartIndices[i + 1] = prevIndex + way.length / 2
		})
		console.timeEnd("Osm.getWaysInBbox.loop")

		const wayPositionsArray = new Float64Array(size)
		let pIndex = 0
		for (const way of wayPositions) {
			wayPositionsArray.set(way, pIndex)
			pIndex += way.length
		}

		console.timeEnd("Osm.getWaysInBbox")
		return {
			indexes: wayIndexes,
			positions: wayPositionsArray,
			startIndices: wayStartIndices,
		}
	}

	getBitmapForBbox(bbox: GeoBbox2D, tileSize = 512) {
		console.time("Osm.getBitmapForBbox")
		const bitmap = new Bitmap(bbox, tileSize)

		const wayCandidates = this.ways.intersects(bbox)
		console.time("Osm.getBitmapForBbox.ways")
		for (const wayIndex of wayCandidates) {
			const wayPositions = this.ways.getLine(wayIndex)
			bitmap.drawWay(wayPositions)
		}
		console.timeEnd("Osm.getBitmapForBbox.ways")

		const nodeCandidates = this.nodes.withinBbox(bbox)
		console.time("Osm.getBitmapForBbox.nodes")
		for (const nodeIndex of nodeCandidates) {
			if (!this.nodes.tags.hasTags(nodeIndex)) continue
			const [lon, lat] = this.nodes.getNodeLonLat({ index: nodeIndex })
			bitmap.setLonLat(lon, lat, [255, 0, 0, 255])
		}
		console.timeEnd("Osm.getBitmapForBbox.nodes")

		console.timeEnd("Osm.getBitmapForBbox")
		return bitmap.data
	}

	getNodesBitmapForBbox(bbox: GeoBbox2D, tileSize = 512) {
		console.time("Osm.getNodesBitmapForBbox")
		const bitmap = new Bitmap(bbox, tileSize)
		const nodeCandidates = this.nodes.withinBbox(bbox)
		for (const nodeIndex of nodeCandidates) {
			const [lon, lat] = this.nodes.getNodeLonLat({ index: nodeIndex })
			if (!this.nodes.tags.hasTags(nodeIndex)) {
				bitmap.setLonLat(lon, lat)
			} else {
				bitmap.setLonLat(lon, lat, [255, 0, 0, 255])
			}
		}
		console.timeEnd("Osm.getNodesBitmapForBbox")
		return bitmap.data
	}

	getWaysBitmapForBbox(bbox: GeoBbox2D, tileSize = 512) {
		console.time("Osm.getWaysBitmapForBbox")
		const bitmap = new Bitmap(bbox, tileSize)
		const wayCandidates = this.ways.intersects(bbox)

		for (const wayIndex of wayCandidates) {
			const wayPositions = this.ways.getLine(wayIndex)
			bitmap.drawWay(wayPositions)
		}
		console.timeEnd("Osm.getWaysBitmapForBbox")
		return bitmap.data
	}

	getEntityBbox(entity: OsmNode | OsmWay | OsmRelation): GeoBbox2D {
		if (isNode(entity)) {
			return bbox(nodeToFeature(entity)) as GeoBbox2D
		}
		if (isWay(entity)) {
			return bbox(wayToFeature(entity, this.nodes)) as GeoBbox2D
		}
		if (isRelation(entity)) {
			return bbox(relationToFeature(entity, this.nodes)) as GeoBbox2D
		}
		throw new Error("Unknown entity type")
	}

	createNode(lonLat: LonLat) {
		const maxNodeId = this.nodes.ids.at(-1) ?? 0
		return this.nodes.addNode({
			id: maxNodeId + 1,
			...lonLat,
		})
	}

	headerBbox(): GeoBbox2D | undefined {
		if (this.header.bbox) {
			return [
				this.header.bbox.left,
				this.header.bbox.bottom,
				this.header.bbox.right,
				this.header.bbox.top,
			]
		}
	}

	bbox(): GeoBbox2D | undefined {
		return this.nodes.bbox ?? this.headerBbox()
	}

	getBboxOfNodes() {
		return this.nodes.bbox
	}

	generateChangeset(patch: Osm): Changeset {
		const changeset = new Changeset(this)
		changeset.generateFullChangeset(patch)
		return changeset
	}

	toGeoJSON(nodeFilter?: (node: OsmNode) => boolean) {
		return [
			...nodesToFeatures(this.nodes, nodeFilter),
			...waysToFeatures(this.ways, this.nodes),
		]
	}

	/**
	 * Create a deep clone of the OSM data.
	 * TODO clone the indexes and string table directly.
	 * @returns A new Osm object with the same header and entities.
	 */
	clone() {
		const clone = new Osm(this.header)
		for (const node of this.nodes) {
			clone.nodes.addNode(structuredClone(node))
		}
		clone.nodes.finish()
		for (const way of this.ways) {
			clone.ways.addWay(structuredClone(way))
		}
		clone.ways.finish()
		for (const relation of this.relations) {
			clone.relations.addRelation(structuredClone(relation))
		}
		clone.finish()
		return clone
	}

	async writePbfToStream(stream: WritableStream<Uint8Array>) {
		const writer = new OsmPbfWriter(stream)
		const bbox = this.getBboxOfNodes()
		await writer.writeHeader({
			...this.header,
			bbox: {
				left: bbox[0],
				bottom: bbox[1],
				right: bbox[2],
				top: bbox[3],
			},
			writingprogram: "@conveyal/osm.ts",
			osmosis_replication_timestamp: Date.now(),
		})
		const primitives = this.generatePbfPrimitiveBlocks()
		for await (const block of primitives) {
			await writer.writePrimitiveBlock(block)
		}
	}

	/**
	 * Generate primitive blocks from this OSM object for writing to a PBF file.
	 *
	 * TODO: Sort nodes and ways?
	 * @returns a generator that produces primitive blocks
	 */
	async *generatePbfPrimitiveBlocks(): AsyncGenerator<OsmPbfPrimitiveBlock> {
		const nodes = Array.from(this.nodes)
		for (let i = 0; i < nodes.length; i += MAX_ENTITIES_PER_BLOCK) {
			const block = new PrimitiveBlockBuilder()
			block.addDenseNodes(nodes.slice(i, i + MAX_ENTITIES_PER_BLOCK))
			yield block
		}

		let block = new PrimitiveBlockBuilder()
		for (const way of this.ways) {
			if (block.isFull()) {
				yield block
				block = new PrimitiveBlockBuilder()
			}
			block.addEntity(way)
		}
		if (!block.isEmpty()) {
			yield block
		}

		block = new PrimitiveBlockBuilder()
		for (const relation of this.relations) {
			if (block.isFull()) {
				yield block
				block = new PrimitiveBlockBuilder()
			}
			block.addEntity(relation)
		}

		if (!block.isEmpty()) {
			yield block
		}
	}
}
