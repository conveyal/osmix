import {
	type GeoBbox2D,
	isNode,
	isRelation,
	isWay,
	type LonLat,
	nodeToFeature,
	type OsmEntity,
	type OsmEntityType,
	type OsmEntityTypeMap,
	type OsmixGeoJSONFeature,
	OsmJsonToBlocksTransformStream,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
	relationToFeature,
	wayToFeature,
} from "@osmix/json"
import {
	type AsyncGeneratorValue,
	OsmBlocksToPbfBytesTransformStream,
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
	readOsmPbf,
} from "@osmix/pbf"
import { Nodes, type NodesTransferables } from "./nodes"
import { Relations, type RelationsTransferables } from "./relations"
import StringTable, { type StringTableTransferables } from "./stringtable"
import { IdArrayType } from "./typed-arrays"
import { bboxFromLonLats, throttle } from "./utils"
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
	blocksGenerator: AsyncGenerator<OsmPbfBlock> | null = null

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
		osm.ways = Ways.from(osm.stringTable, ways)
		osm.relations = Relations.from(osm.stringTable, relations)
		osm.buildTimeMs = parsingTimeMs
		osm.#indexBuilt = true
		return osm
	}

	/**
	 * Easiest way to get started with Osmix. Reads a PBF file into an Osmix index. Logs progress to the console.
	 */
	static async fromPbf(
		data: AsyncGeneratorValue<ArrayBufferLike>,
		options: Partial<OsmixOptions> = {},
	) {
		const osm = new Osmix(options)
		await osm.readPbf(data, options)

		// By default, build all spatial indexes.
		if (!Array.isArray(options.buildSpatialIndexes)) {
			osm.buildSpatialIndexes()
		} else if (options.buildSpatialIndexes.includes("node")) {
			osm.nodes.buildSpatialIndex()
		} else if (options.buildSpatialIndexes.includes("way")) {
			osm.ways.buildSpatialIndex(osm.nodes)
		}

		return osm
	}

	constructor(options: Partial<OsmixOptions> = {}) {
		if (options.header) this.header = options.header
		if (options.id) this.id = options.id
		if (options.logger) this.log = options.logger
		this.stringTable = new StringTable()
		this.nodes = new Nodes(this.stringTable)
		this.ways = new Ways(this.stringTable)
		this.relations = new Relations(this.stringTable)
	}

	setLogger(listener: (message: string, type?: LogLevel) => void) {
		this.log = listener
	}

	createThrottledLog(interval: number) {
		return throttle(this.log, interval)
	}

	buildIndexes() {
		if (!this.nodes.isReady) this.nodes.buildIndex()
		if (!this.ways.isReady) this.ways.buildIndex()
		if (!this.relations.isReady) this.relations.buildIndex()
		this.stringTable.buildIndex()
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

	async readPbf(
		data: AsyncGeneratorValue<ArrayBufferLike>,
		options: Partial<OsmixOptions> = {},
	) {
		if (this.#indexBuilt) throw Error("Osmix built. Create new instance.")
		const { extractBbox } = options
		const { header, blocks } = await readOsmPbf(data)
		this.header = header
		if (extractBbox) {
			this.header.bbox = {
				left: extractBbox[0],
				bottom: extractBbox[1],
				right: extractBbox[2],
				top: extractBbox[3],
			}
		}
		const logEverySecond = this.createThrottledLog(1_000)

		for await (const block of blocks) {
			const blockStringIndexMap = this.stringTable.createBlockIndexMap(block)

			for (const group of block.primitivegroup) {
				const { nodes, ways, relations, dense } = group
				if (nodes && nodes.length > 0) {
					throw Error("Nodes must be dense!")
				}

				if (dense) {
					this.nodes.addDenseNodes(
						dense,
						block,
						blockStringIndexMap,
						extractBbox
							? (node: OsmNode) => {
									return (
										node.lon >= extractBbox[0] &&
										node.lon <= extractBbox[2] &&
										node.lat >= extractBbox[1] &&
										node.lat <= extractBbox[3]
									)
								}
							: undefined,
					)

					logEverySecond(`${this.nodes.size.toLocaleString()} nodes added`)
				}

				if (ways.length > 0) {
					// Nodes are finished, build their index.
					if (!this.nodes.isReady) this.nodes.buildIndex()
					this.ways.addWays(
						ways,
						blockStringIndexMap,
						extractBbox
							? (way: OsmWay) => {
									const refs = way.refs.filter((ref) => this.nodes.ids.has(ref))
									if (refs.length === 0) return null
									return {
										...way,
										refs,
									}
								}
							: undefined,
					)

					logEverySecond(`${this.ways.size.toLocaleString()} ways added`)
				}

				if (relations.length > 0) {
					if (!this.ways.isReady) this.ways.buildIndex()
					this.relations.addRelations(
						relations,
						blockStringIndexMap,
						extractBbox
							? (relation: OsmRelation) => {
									const members = relation.members.filter((member) => {
										if (member.type === "node")
											return this.nodes.ids.has(member.ref)
										if (member.type === "way")
											return this.ways.ids.has(member.ref)
										return false
									})
									if (members.length === 0) return null
									return {
										...relation,
										members,
									}
								}
							: undefined,
					)

					logEverySecond(
						`${this.relations.size.toLocaleString()} relations added`,
					)
				}
			}
		}

		this.log(
			`${this.nodes.size.toLocaleString()} nodes, ${this.ways.size.toLocaleString()} ways, and ${this.relations.size.toLocaleString()} relations added.`,
		)
		this.log("Building remaining id and tag indexes...")
		this.buildIndexes()
	}

	buildSpatialIndexes() {
		this.nodes.buildSpatialIndex()
		this.ways.buildSpatialIndex(this.nodes)
	}

	extract(bbox: GeoBbox2D) {
		if (!this.#indexBuilt) this.buildIndexes()

		const [minLon, minLat, maxLon, maxLat] = bbox
		const extracted = new Osmix({
			id: this.id,
			header: {
				...this.header,
				bbox: {
					left: minLon,
					bottom: minLat,
					right: maxLon,
					top: maxLat,
				},
			},
		})

		this.log("Selecting nodes within bounding box...")
		this.buildSpatialIndexes()
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
		extracted.nodes.buildIndex()

		this.log("Selecting ways within bounding box...")
		for (const way of this.ways.sorted()) {
			const refs = way.refs.filter((ref) => extracted.nodes.ids.has(ref))
			if (refs.length > 0) {
				extracted.ways.addWay({
					...way,
					refs,
				})
			}
		}
		extracted.ways.buildIndex()

		this.log("Selecting relations within bounding box...")
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

		extracted.buildIndexes()
		return extracted
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
				throw new Error(`Unknown entity type: ${type}`)
			}
		}
	}

	getNodesInBbox(bbox: GeoBbox2D, allNodes = false) {
		if (!this.#indexBuilt) throw new Error("Osm not finished")
		console.time("Osm.getNodesInBbox")
		const nodeCandidates = this.nodes.withinBbox(bbox)
		const nodePositions = new Float64Array(nodeCandidates.length * 2)
		const ids = new IdArrayType(nodeCandidates.length)
		nodeCandidates.forEach((nodeIndex, i) => {
			// Skip nodes with no tags, likely just a way node
			if (!allNodes && this.nodes.tags.cardinality(nodeIndex) === 0) return

			const [lon, lat] = this.nodes.getNodeLonLat({ index: nodeIndex })
			ids[i] = this.nodes.ids.at(nodeIndex)
			nodePositions[i * 2] = lon
			nodePositions[i * 2 + 1] = lat
		})
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
			return relationToFeature(entity, (ref) =>
				this.nodes.getNodeLonLat({ id: ref }),
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

	/**
	 * Convert the OSM index to a `ReadableStream<OsmPbfHeaderBlock | OsmEntity>`.
	 */
	toEntityStream() {
		let headerEnqueued = false
		const entityGenerator = this.allEntitiesSorted()
		return new ReadableStream<OsmPbfHeaderBlock | OsmEntity>({
			pull: async (controller) => {
				if (!headerEnqueued) {
					controller.enqueue({
						...this.header,
						writingprogram: "@osmix/core",
						osmosis_replication_timestamp: Date.now(),
					})
					headerEnqueued = true
				}
				const block = entityGenerator.next()
				if (block.done) {
					controller.close()
				} else {
					controller.enqueue(block.value)
				}
			},
		})
	}

	/**
	 * Convert the OSM index to a `ReadableStream<Uint8Array>` of PBF bytes.
	 */
	toPbfStream() {
		return this.toEntityStream()
			.pipeThrough(new OsmJsonToBlocksTransformStream())
			.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
	}

	/**
	 * Convert the OSM index to an in memory PBF ArrayBuffer.
	 */
	async toPbfBuffer() {
		const chunks: Uint8Array[] = []
		let byteLength = 0
		const writable = new WritableStream<Uint8Array>({
			write(chunk) {
				chunks.push(chunk)
				byteLength += chunk.byteLength
			},
		})
		await this.toPbfStream().pipeTo(writable)
		const combined = new Uint8Array(byteLength)
		let offset = 0
		for (const chunk of chunks) {
			combined.set(chunk, offset)
			offset += chunk.byteLength
		}
		return combined.buffer
	}
}
