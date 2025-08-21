import { bbox } from "@turf/turf"
import { Nodes, type NodesTransferables } from "./nodes"
import { createOsmIndexFromPbfData } from "./osm-from-pbf"
import type {
	OsmPbfHeaderBlock,
	OsmPbfPrimitiveBlock,
} from "./pbf/proto/osmformat"
import { Bitmap } from "./raster"
import { Relations, type RelationsTransferables } from "./relations"
import StringTable, { type StringTableTransferables } from "./stringtable"
import { nodeToFeature, relationToFeature, wayToFeature } from "./to-geojson"
import type {
	GeoBbox2D,
	LonLat,
	OsmEntityType,
	OsmEntityTypeMap,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./types"
import { isNode, isRelation, isWay } from "./utils"
import { Ways, type WaysTransferables } from "./ways"
import { IdArrayType } from "./typed-arrays"
import OsmChangeset from "./changeset"

export interface OsmTransferables {
	id: string
	header: OsmPbfHeaderBlock
	stringTable: StringTableTransferables
	nodes: NodesTransferables
	ways: WaysTransferables
	relations: RelationsTransferables
	parsingTimeMs: number
}

/**
 * OSM Entity Index.
 */
export class Osm {
	// Filename or ID of this OSM Entity index.
	id: string
	header: OsmPbfHeaderBlock
	blocksGenerator: AsyncGenerator<OsmPbfPrimitiveBlock> | null = null

	// Shared string lookup table for all nodes, ways, and relations
	stringTable: StringTable = new StringTable()
	nodes: Nodes = new Nodes(this.stringTable)
	ways: Ways = new Ways(this.stringTable)
	relations: Relations = new Relations(this.stringTable)

	#finished = false
	#startTime = performance.now()
	parsingTimeMs = 0

	static from({
		id,
		header,
		stringTable,
		nodes,
		ways,
		relations,
		parsingTimeMs,
	}: OsmTransferables) {
		const osm = new Osm(id, header)
		osm.stringTable = StringTable.from(stringTable)
		osm.nodes = Nodes.from(osm.stringTable, nodes)
		osm.ways = Ways.from(osm.stringTable, ways)
		osm.relations = Relations.from(osm.stringTable, relations)
		osm.parsingTimeMs = parsingTimeMs
		osm.#finished = true
		return osm
	}

	static async fromFile(file: File) {
		return createOsmIndexFromPbfData(file.name, file.stream(), console.log)
	}

	static async fromPbfData(
		data: ArrayBuffer | ReadableStream<Uint8Array>,
		id = "unknown",
		onProgess: (...args: string[]) => void = console.log,
	) {
		return createOsmIndexFromPbfData(id, data, onProgess)
	}

	constructor(id?: string, header?: OsmPbfHeaderBlock) {
		this.header = header ?? {
			required_features: [],
			optional_features: [],
		}
		this.id = id ?? "unknown"
	}

	buildSpatialIndexes() {
		this.nodes.buildSpatialIndex()
		this.ways.buildSpatialIndex(this.nodes)
	}

	finish() {
		if (!this.nodes.isReady) this.nodes.finish()
		if (!this.ways.isReady) this.ways.finish()
		if (!this.relations.isReady) this.relations.finish()
		this.buildSpatialIndexes()
		this.stringTable.compact()
		this.#finished = true
		this.parsingTimeMs = performance.now() - this.#startTime
	}

	isFinished() {
		return this.#finished
	}

	transferables(): OsmTransferables {
		return {
			id: this.id,
			header: this.header,
			stringTable: this.stringTable.transferables(),
			nodes: this.nodes.transferables(),
			ways: this.ways.transferables(),
			relations: this.relations.transferables(),
			parsingTimeMs: this.parsingTimeMs,
		}
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
		const ids = new IdArrayType(nodeCandidates.length)
		let pIndex = 0
		for (const nodeIndex of nodeCandidates) {
			// Skip nodes with no tags, likely just a way node
			if (!this.nodes.tags.hasTags(nodeIndex)) continue

			const [lon, lat] = this.nodes.getNodeLonLat({ index: nodeIndex })
			ids[pIndex] = this.nodes.ids.at(nodeIndex)
			nodePositions[pIndex++] = lon
			nodePositions[pIndex++] = lat
		}
		console.timeEnd("Osm.getNodesInBbox")
		return {
			ids,
			positions: nodePositions,
		}
	}

	getWaysInBbox(bbox: GeoBbox2D) {
		console.time("Osm.getWaysInBbox")
		const wayCandidates = this.ways.intersects(bbox)
		const ids = new IdArrayType(wayCandidates.length)
		const wayPositions: Float64Array[] = []
		const wayStartIndices = new Uint32Array(wayCandidates.length + 1)
		wayStartIndices[0] = 0

		console.time("Osm.getWaysInBbox.loop")
		let size = 0
		wayCandidates.forEach((wayIndex, i) => {
			ids[i] = this.ways.ids.at(wayIndex)
			const way = this.ways.getLine(wayIndex, this.nodes)
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
			ids,
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
			const wayPositions = this.ways.getLine(wayIndex, this.nodes)
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
			const wayPositions = this.ways.getLine(wayIndex, this.nodes)
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

	generateChangeset(other: Osm) {
		const changeset = new OsmChangeset(this)
		changeset.generateFullChangeset(other)
		return changeset
	}
}
