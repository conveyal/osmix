import {
	isNode,
	isRelation,
	isWay,
	nodeToFeature,
	type OsmEntity,
	type OsmEntityType,
	type OsmEntityTypeMap,
	type OsmixGeoJSONFeature,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
	relationToFeature,
	wayToFeature,
} from "@osmix/json"
import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import type { GeoBbox2D, LonLat } from "@osmix/shared/types"
import { Nodes, type NodesTransferables } from "./nodes"
import { Relations, type RelationsTransferables } from "./relations"
import StringTable, { type StringTableTransferables } from "./stringtable"
import { IdArrayType } from "./typed-arrays"
import { bboxFromLonLats } from "./utils"
import { Ways, type WaysTransferables } from "./ways"

export interface OsmixTransferables {
	id: string
	header: OsmPbfHeaderBlock
	stringTable: StringTableTransferables
	nodes: NodesTransferables
	ways: WaysTransferables
	relations: RelationsTransferables
	parsingTimeMs: number
}

export interface OsmixOptions {
	id: string
	extractBbox: GeoBbox2D
	logger: (message: string, type?: LogLevel) => void
	filter<T extends OsmEntityType>(
		type: T,
		entity: OsmEntityTypeMap[T],
		osmix: Osmix,
	): boolean
	header: OsmPbfHeaderBlock
	buildSpatialIndexes: OsmEntityType[]

	// Future options
	// include: OsmEntityType[]
}

export type LogLevel = "debug" | "info" | "warn" | "error"

/**
 * OSM Entity Index.
 */
export class Osmix {
	// Filename or ID of this OSM Entity index.
	id = "unknown"
	header: OsmPbfHeaderBlock = {
		required_features: [],
		optional_features: [],
	}

	// Shared string lookup table for all nodes, ways, and relations
	stringTable: StringTable
	nodes: Nodes
	ways: Ways
	relations: Relations

	log = (message: string, type?: LogLevel) =>
		type === "error" ? console.error(message) : console.log(message)

	#indexBuilt = false
	#startTime = performance.now()
	buildTimeMs = 0

	static from({
		id,
		header,
		stringTable,
		nodes,
		ways,
		relations,
		parsingTimeMs,
	}: OsmixTransferables) {
		const osm = new Osmix({ id, header })
		osm.stringTable = StringTable.from(stringTable)
		osm.nodes = Nodes.from(osm.stringTable, nodes)
		osm.ways = Ways.from(osm.stringTable, osm.nodes, ways)
		osm.relations = Relations.from(osm.stringTable, relations)
		osm.buildTimeMs = parsingTimeMs
		osm.#indexBuilt = true
		return osm
	}

	constructor(options: Partial<OsmixOptions> = {}) {
		if (options.header) this.header = options.header
		if (options.id) this.id = options.id
		if (options.logger) this.log = options.logger
		this.stringTable = new StringTable()
		this.nodes = new Nodes(this.stringTable)
		this.ways = new Ways(this.stringTable, this.nodes)
		this.relations = new Relations(this.stringTable)
	}

	buildIndexes() {
		this.stringTable.buildIndex()
		if (!this.nodes.isReady) this.nodes.buildIndex()
		if (!this.ways.isReady) this.ways.buildIndex()
		if (!this.relations.isReady) this.relations.buildIndex()
		this.#indexBuilt = true
		this.buildTimeMs = performance.now() - this.#startTime
	}

	isReady() {
		return this.#indexBuilt
	}

	transferables(): OsmixTransferables {
		return {
			id: this.id,
			header: this.header,
			stringTable: this.stringTable.transferables(),
			nodes: this.nodes.transferables(),
			ways: this.ways.transferables(),
			relations: this.relations.transferables(),
			parsingTimeMs: this.buildTimeMs,
		}
	}

	buildSpatialIndexes() {
		this.nodes.buildSpatialIndex()
		this.ways.buildSpatialIndex()
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
		const [type, sid] = eid.split("/")
		const id = Number(sid)
		switch (type) {
			case "node":
				return this.nodes.getById(id)
			case "way":
				return this.ways.getById(id)
			case "relation":
				return this.relations.getById(id)
			default: {
				return null
			}
		}
	}

	getNodesInBbox(bbox: GeoBbox2D, allNodes = false) {
		if (!this.#indexBuilt) throw new Error("Osm not finished")
		console.time("Osm.getNodesInBbox")
		const nodeCandidates = this.nodes.findIndexesWithinBbox(bbox)
		const nodePositions = new Float64Array(nodeCandidates.length * 2)
		const ids = new IdArrayType(nodeCandidates.length)

		let skipped = 0
		nodeCandidates.forEach((nodeIndex, i) => {
			// Skip nodes with no tags, likely just a way node
			if (!allNodes && this.nodes.tags.cardinality(nodeIndex) === 0) {
				skipped++
				return
			}

			const [lon, lat] = this.nodes.getNodeLonLat({ index: nodeIndex })
			ids[i - skipped] = this.nodes.ids.at(nodeIndex)
			nodePositions[(i - skipped) * 2] = lon
			nodePositions[(i - skipped) * 2 + 1] = lat
		})
		console.timeEnd("Osm.getNodesInBbox")
		return {
			ids: ids.subarray(0, nodeCandidates.length - skipped),
			positions: nodePositions.slice(0, (nodeCandidates.length - skipped) * 2),
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
			const way = this.ways.getLine(wayIndex)
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

	getEntityGeoJson(
		entity: OsmNode | OsmWay | OsmRelation,
	): OsmixGeoJSONFeature<
		GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.MultiPolygon
	> {
		if (isNode(entity)) {
			return nodeToFeature(entity)
		}
		if (isWay(entity)) {
			return wayToFeature(entity, (ref) =>
				this.nodes.getNodeLonLat({ id: ref }),
			)
		}
		if (isRelation(entity)) {
			return relationToFeature(
				entity,
				(ref) => this.nodes.getNodeLonLat({ id: ref }),
				(ref) => this.ways.getById(ref),
			)
		}
		throw new Error("Unknown entity type")
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
					const ll = this.nodes.getNodeLonLat({ id: member.ref })
					lls.push(ll)
				} else if (member.type === "way") {
					const wayIndex = this.ways.ids.getIndexFromId(member.ref)
					if (wayIndex === -1) throw Error("Way not found")
					const wayPositions = this.ways.getCoordinates(wayIndex, this.nodes)
					lls.push(...wayPositions)
				}
			}
			return bboxFromLonLats(lls)
		}
		throw Error("Unknown entity type")
	}

	/**
	 * Get the bounding box of all entities in the OSM index.
	 */
	bbox(): GeoBbox2D {
		return this.nodes.bbox
	}

	/**
	 * Create a generator that yields all entities in the OSM index, sorted by type and id.
	 */
	*allEntitiesSorted(): Generator<OsmEntity> {
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
}
