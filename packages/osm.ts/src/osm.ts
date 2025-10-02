import {
	isNode,
	isRelation,
	isWay,
	type LonLat,
	type OsmEntity,
	type OsmEntityType,
	type OsmEntityTypeMap,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
} from "@osmix/json"
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "@osmix/pbf"
import { Nodes, type NodesTransferables } from "./nodes"
import { Relations, type RelationsTransferables } from "./relations"
import StringTable, { type StringTableTransferables } from "./stringtable"
import { IdArrayType } from "./typed-arrays"
import type { GeoBbox2D } from "./types"
import { bboxFromLonLats } from "./utils"
import { Ways, type WaysTransferables } from "./ways"

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
	blocksGenerator: AsyncGenerator<OsmPbfBlock> | null = null

	// Shared string lookup table for all nodes, ways, and relations
	stringTable: StringTable
	nodes: Nodes
	ways: Ways
	relations: Relations

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

	constructor(id?: string, header?: OsmPbfHeaderBlock) {
		this.header = header ?? {
			required_features: [],
			optional_features: [],
		}
		this.id = id ?? "unknown"
		this.stringTable = new StringTable()
		this.nodes = new Nodes(this.stringTable)
		this.ways = new Ways(this.stringTable)
		this.relations = new Relations(this.stringTable)
	}

	*generateSortedEntities(): Generator<OsmEntity> {
		for (const node of this.nodes.sorted()) {
			yield node
		}
		for (const way of this.ways.sorted()) {
			yield way
		}
		for (const relation of this.relations.sorted()) {
			yield relation
		}
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

	getById(eid: string): OsmEntity | null {
		const id = Number(eid.slice(1))
		switch (eid.charAt(0)) {
			case "n":
				return this.nodes.getById(id)
			case "w":
				return this.ways.getById(id)
			case "r":
				return this.relations.getById(id)
			default: {
				const fid = Number(eid)
				return (
					this.nodes.getById(fid) ??
					this.ways.getById(fid) ??
					this.relations.getById(fid)
				)
			}
		}
	}

	getNodesInBbox(bbox: GeoBbox2D) {
		if (!this.#finished) throw new Error("Osm not finished")
		console.time("Osm.getNodesInBbox")
		const nodeCandidates = this.nodes.withinBbox(bbox)
		const nodePositions = new Float64Array(nodeCandidates.length * 2)
		const ids = new IdArrayType(nodeCandidates.length)
		for (let i = 0; i < nodeCandidates.length; i++) {
			const nodeIndex = nodeCandidates[i]
			// Skip nodes with no tags, likely just a way node
			if (!this.nodes.tags.hasTags(nodeIndex)) continue

			const [lon, lat] = this.nodes.getNodeLonLat({ index: nodeIndex })
			ids[i] = this.nodes.ids.at(nodeIndex)
			nodePositions[i * 2] = lon
			nodePositions[i * 2 + 1] = lat
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

	getEntityBbox(entity: OsmNode | OsmWay | OsmRelation): GeoBbox2D {
		if (isNode(entity)) {
			const [lon, lat] = this.nodes.getNodeLonLat({ id: entity.id })
			return [lon, lat, lon, lat] as GeoBbox2D
		}
		if (isWay(entity)) {
			return this.ways.getBbox({ id: entity.id })
		}
		if (isRelation(entity)) {
			const relation = this.relations.getById(entity.id)
			if (!relation) throw Error("Relation not found")
			const lls: LonLat[] = []
			for (const member of relation.members) {
				if (member.type === "node") {
					const [lon, lat] = this.nodes.getNodeLonLat({ id: member.ref })
					lls.push({ lon, lat })
				} else if (member.type === "way") {
					const wayIndex = this.ways.ids.getIndexFromId(member.ref)
					if (wayIndex === -1) throw Error("Way not found")
					const wayPositions = this.ways.getCoordinates(wayIndex, this.nodes)
					for (const position of wayPositions) {
						lls.push({ lon: position[0], lat: position[1] })
					}
				}
			}
			return bboxFromLonLats(lls)
		}
		throw Error("Unknown entity type")
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
}
