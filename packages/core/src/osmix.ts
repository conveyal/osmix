import {
	isNode,
	isRelation,
	isWay,
	type LonLat,
	nodeToFeature,
	type OsmEntity,
	type OsmEntityType,
	type OsmEntityTypeMap,
	type OsmNode,
	type OsmRelation,
	type OsmTags,
	type OsmWay,
	relationToFeature,
	wayToFeature,
} from "@osmix/json"
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "@osmix/pbf"
import OsmChangeset from "./changeset"
import { Nodes, type NodesTransferables } from "./nodes"
import { createOsmIndexFromPbfData } from "./osm-from-pbf"
import { OsmixRasterTile } from "./raster-tile"
import { Relations, type RelationsTransferables } from "./relations"
import StringTable, { type StringTableTransferables } from "./stringtable"
import { IdArrayType } from "./typed-arrays"
import type { GeoBbox2D, TileIndex } from "./types"
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

/**
 * OSM Entity Index.
 */
export class Osmix {
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
	}: OsmixTransferables) {
		const osm = new Osmix(id, header)
		osm.stringTable = StringTable.from(stringTable)
		osm.nodes = Nodes.from(osm.stringTable, nodes)
		osm.ways = Ways.from(osm.stringTable, ways)
		osm.relations = Relations.from(osm.stringTable, relations)
		osm.parsingTimeMs = parsingTimeMs
		osm.#finished = true
		return osm
	}

	static fromPbf(
		data: ArrayBufferLike | ReadableStream,
		id?: string,
		onProgress?: (message: string) => void,
	) {
		return createOsmIndexFromPbfData(data, { id, onProgress })
	}

	static async extractFromPbf(
		data: ArrayBufferLike | ReadableStream<ArrayBufferLike>,
		bbox: GeoBbox2D,
		id?: string,
		onProgress?: (message: string) => void,
	) {
		const [minLon, minLat, maxLon, maxLat] = bbox
		const osm = await createOsmIndexFromPbfData(data, {
			id,
			onProgress,
			filterNode: (node) => {
				return (
					node.lon >= minLon &&
					node.lon <= maxLon &&
					node.lat >= minLat &&
					node.lat <= maxLat
				)
			},
			filterWay: (way, osm) => {
				const refs = way.refs.filter((ref) => osm.nodes.ids.has(ref))
				if (refs.length === 0) return null
				return {
					...way,
					refs,
				}
			},
			filterRelation: (relation, osm) => {
				const members = relation.members.filter((member) => {
					if (member.type === "node") return osm.nodes.ids.has(member.ref)
					if (member.type === "way") return osm.ways.ids.has(member.ref)
					return false
				})
				if (members.length === 0) return null
				return {
					...relation,
					members,
				}
			},
		})

		osm.header = {
			...osm.header,
			bbox: {
				left: minLon,
				bottom: minLat,
				right: maxLon,
				top: maxLat,
			},
		}

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

	createChangeset() {
		return new OsmChangeset(this)
	}

	extract(bbox: GeoBbox2D, onProgress?: (message: string) => void) {
		if (!this.#finished) this.finish()

		const [minLon, minLat, maxLon, maxLat] = bbox
		const report = onProgress ?? console.log

		const extracted = new Osmix(this.id, {
			...this.header,
			bbox: {
				left: minLon,
				bottom: minLat,
				right: maxLon,
				top: maxLat,
			},
		})

		report("Selecting nodes within bounding box...")
		for (const node of this.nodes.sorted()) {
			if (
				node.lon >= minLon &&
				node.lon <= maxLon &&
				node.lat >= minLat &&
				node.lat <= maxLat
			) {
				extracted.nodes.addNode(node)
			}
		}
		extracted.nodes.finish()

		report("Selecting ways within bounding box...")
		for (const way of this.ways.sorted()) {
			const refs = way.refs.filter((ref) => extracted.nodes.ids.has(ref))
			if (refs.length > 0) {
				extracted.ways.addWay({
					...way,
					refs,
				})
			}
		}
		extracted.ways.finish()

		report("Selecting relations within bounding box...")
		for (const relation of this.relations.sorted()) {
			const members = relation.members.filter((m) => {
				if (m.type === "node") return extracted.nodes.ids.has(m.ref)
				if (m.type === "way") return extracted.ways.ids.has(m.ref)
				return false
			})
			if (members.length > 0) {
				extracted.relations.addRelation({
					...relation,
					members,
				})
			}
		}

		extracted.finish()
		return extracted
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

	transferables(): OsmixTransferables {
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

	/**
	 * Creates an empty raster tile for the given bbox and tile index that is linked to this OSM index.
	 */
	createRasterTile(bbox: GeoBbox2D, tileIndex: TileIndex, tileSize: number) {
		return new OsmixRasterTile(this, bbox, tileIndex, tileSize)
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

	getEntityGeoJson(
		entity: OsmNode | OsmWay | OsmRelation,
	): GeoJSON.Feature<GeoJSON.Geometry, OsmTags> {
		if (isNode(entity)) {
			return nodeToFeature(entity)
		}
		if (isWay(entity)) {
			return wayToFeature(entity, (ref) =>
				this.nodes.getNodeLonLat({ id: ref }),
			)
		}
		if (isRelation(entity)) {
			return relationToFeature(entity, (ref) =>
				this.nodes.getNodeLonLat({ id: ref }),
			)
		}
		throw new Error("Unknown entity type")
	}
}
