import {
	bbox,
	booleanTouches,
	cleanCoords,
	lineIntersect,
	nearestPointOnLine,
} from "@turf/turf"
import { createOsmPbfReader } from "./pbf/osm-pbf-reader"
import {
	PrimitiveBlockBuilder,
	MAX_ENTITIES_PER_BLOCK,
} from "./pbf/primitive-block-builder"
import { PrimitiveBlockParser } from "./pbf/primitive-block-parser"
import type {
	OsmPbfHeaderBlock,
	OsmPbfPrimitiveBlock,
} from "./pbf/proto/osmformat"
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
	OsmChange,
	OsmEntityType,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./types"
import UnorderedPairMap from "./unordered-pair-map"
import { isNode, isRelation, isWay } from "./utils"
import { wayIsArea } from "./way-is-area"
import { OsmPbfWriter } from "./pbf/osm-pbf-writer"
import { NodeIndex } from "./node-index"
import { WayIndex } from "./way-index"
import { RelationIndex } from "./relation-index"
import StringTable from "./stringtable"
import { ResizeableCoordinateArray, ResizeableTypedArray } from "./typed-arrays"

/**
 * Requires sorted IDs.
 */
export class Osm {
	header: OsmPbfHeaderBlock
	blocksGenerator: AsyncGenerator<OsmPbfPrimitiveBlock> | null = null

	// Shared string lookup table for all nodes, ways, and relations
	stringTable = new StringTable()
	nodes: NodeIndex = new NodeIndex(this.stringTable)
	ways: WayIndex = new WayIndex(this.stringTable, this.nodes)
	relations: RelationIndex = new RelationIndex(
		this.stringTable,
		this.nodes,
		this.ways,
	)

	#finished = false
	parsingTimeMs = 0

	static async fromPbfData(data: ArrayBuffer | ReadableStream<Uint8Array>) {
		const osm = new Osm()
		await osm.initFromPbfData(data, () => {})
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

		let entityCount = 0
		let stage: "nodes" | "ways" | "relations" = "nodes"
		let entityUpdateInterval = 100_000
		for await (const block of reader.blocks) {
			const blockParser = new PrimitiveBlockParser(block)
			for (const group of block.primitivegroup) {
				if (group.ways.length > 0 && stage === "nodes") {
					onProgress(
						`Loaded ${this.nodes.size.toLocaleString()} nodes. Building node spatial index...`,
					)
					this.nodes.finish()
					stage = "ways"
					entityCount = 0
					entityUpdateInterval = 100_000
				}

				if (group.relations.length > 0 && stage === "ways") {
					onProgress(
						`Loaded ${this.ways.size.toLocaleString()} ways. Building way spatial index...`,
					)
					this.ways.finish()
					stage = "relations"
					entityCount = 0
					entityUpdateInterval = 100_000
				}

				if (group.dense) {
					this.nodes.addDenseNodes(group.dense, block)
				}

				for (const node of group.nodes) {
					this.nodes.addNode(blockParser.parseNode(node))
				}

				if (group.ways.length > 0) {
					this.ways.addWays(group.ways, block)
				}

				for (const relation of group.relations) {
					this.relations.addRelation(blockParser.parseRelation(relation))
				}

				entityCount +=
					group.nodes.length +
					group.ways.length +
					group.relations.length +
					(group.dense?.id.length ?? 0)
				if (entityCount % entityUpdateInterval === 0) {
					onProgress(`${entityCount.toLocaleString()} ${stage} loaded`)
					if (entityCount > 1_000_000) entityUpdateInterval = 1_000_000
				}
			}
		}
		if (!this.nodes.isReady()) this.nodes.finish()
		if (!this.ways.isReady()) this.ways.finish()
		if (!this.relations.isReady()) this.relations.finish()
		this.finish()
		onProgress(
			`Added ${this.nodes.size.toLocaleString()} nodes, ${this.ways.size.toLocaleString()} ways, and ${this.relations.size.toLocaleString()} relations.`,
		)
		this.parsingTimeMs = performance.now() - start
	}

	finish() {
		this.stringTable.compact()
		this.#finished = true
	}

	isFinished() {
		return this.#finished
	}

	getNodesInBbox(bbox: GeoBbox2D) {
		if (!this.#finished) throw new Error("Osm not finished")
		console.time("Osm.getNodesInBbox")
		const nodeCandidates = this.nodes.within(bbox)
		const nodePositions = new Float32Array(nodeCandidates.length * 2)
		const nodeIndexes = new Uint32Array(nodeCandidates.length)
		let pIndex = 0
		for (const nodeIndex of nodeCandidates) {
			// Skip nodes with no tags, likely just a way node
			if (this.nodes.tagCountByIndex.at(nodeIndex) === 0) continue

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
		const wayPositions = new ResizeableCoordinateArray()
		const wayStartIndices = new Uint32Array(wayCandidates.length + 1)
		wayStartIndices[0] = 0

		for (let i = 0; i < wayCandidates.length; i++) {
			const w = wayCandidates[i]
			wayIndexes[i] = w
			const way = this.ways.getLine(w)
			wayPositions.pushMany(way)
			wayStartIndices[i + 1] = wayStartIndices[i] + way.length / 2
		}

		console.timeEnd("Osm.getWaysInBbox")
		return {
			indexes: wayIndexes,
			positions: wayPositions.compact(),
			startIndices: wayStartIndices,
		}
	}

	getEntitiesInBbox(bbox: GeoBbox2D) {
		if (!this.#finished) throw new Error("Osm not finished")

		const nodeCandidates = this.nodes.within(bbox)
		const nodePositions = new Float32Array(nodeCandidates.length * 2)
		const nodeIndexes = new Uint32Array(nodeCandidates.length)
		let pIndex = 0
		for (const nodeIndex of nodeCandidates) {
			// Skip nodes with no tags, likely just a way node
			if (this.nodes.tagCountByIndex.at(nodeIndex) === 0) continue

			const [lon, lat] = this.nodes.getNodeLonLat({ index: nodeIndex })
			nodeIndexes[pIndex] = nodeIndex
			nodePositions[pIndex++] = lon
			nodePositions[pIndex++] = lat
		}

		const wayCandidates = this.ways.intersects(bbox)
		const wayIndexes = new Uint32Array(wayCandidates.length)
		const wayPositions = new ResizeableTypedArray(Float32Array)
		const wayStartIndices = new Uint32Array(wayCandidates.length + 1)
		wayStartIndices[0] = 0

		for (let i = 0; i < wayCandidates.length; i++) {
			const w = wayCandidates[i]
			wayIndexes[i] = w
			const way = this.ways.getLine(w)
			wayPositions.pushMany(way)
			wayStartIndices[i + 1] = wayStartIndices[i] + way.length / 2
		}

		return {
			nodeIndexes,
			nodePositions,
			wayIndexes,
			wayPositions: wayPositions.compact(),
			wayStartIndices,
		}
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
		const maxNodeId = this.nodes.idByIndex.at(-1) ?? 0
		return this.nodes.addNode({
			id: maxNodeId + 1,
			...lonLat,
		})
	}

	addEntity(entity: OsmNode | OsmWay | OsmRelation | OsmNode[]) {
		if (Array.isArray(entity)) {
			for (const node of entity) {
				this.nodes.addNode(node)
			}
			return
		}

		if (isNode(entity)) {
			this.nodes.addNode(entity)
		} else if (isWay(entity)) {
			this.ways.addWay(entity)
		} else if (isRelation(entity)) {
			this.relations.addRelation(entity)
		}
	}

	getEntity(type: OsmEntityType, id: number) {
		if (type === "node") return this.nodes.getById(id)
		if (type === "way") return this.ways.getById(id)
		if (type === "relation") return this.relations.getById(id)
	}

	deleteEntity(entity: OsmNode | OsmWay | OsmRelation) {
		if (isNode(entity)) this.nodes.remove(entity.id)
		if (isWay(entity)) this.ways.remove(entity.id)
		if (isRelation(entity)) this.relations.remove(entity.id)
	}

	setEntity(entity: OsmNode | OsmWay | OsmRelation) {
		if (isNode(entity)) this.nodes.set(entity)
		if (isWay(entity)) this.ways.set(entity)
		if (isRelation(entity)) this.relations.set(entity)
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

	toGeoJSON(nodeFilter?: (node: OsmNode) => boolean) {
		return [
			...nodesToFeatures(this.nodes, nodeFilter),
			...waysToFeatures(this.ways, this.nodes),
		]
	}

	applyChange(change: OsmChange) {
		if (change.changeType === "create") {
			this.addEntity(change.entity)
		} else if (change.changeType === "delete") {
			this.deleteEntity(change.entity)
		} else {
			this.setEntity(change.entity)
		}
	}

	applyChanges(changes: OsmChange[]) {
		for (const change of changes) {
			this.applyChange(change)
		}
		this.nodes.buildIdIndex()
		this.ways.buildSpatialIndex()
	}

	/**
	 * Deduplicate nodes by merging overlapping nodes.
	 * @param nodes The nodes to check for deduplication. If not provided, all nodes will be checked.
	 */
	dedupeOverlappingNodes(nodes?: NodeIndex) {
		const nodesToBeDeleted = new Set<number>()
		const replacedPairs = new Set<string>()
		for (const node of nodes ?? this.nodes) {
			const closeNodes = this.nodes.findNeighborsWithin(node, 0)
			const closeNode = closeNodes[0]
			if (closeNode == null) continue

			const pairKey = [node.id, closeNode.id].toSorted().join("|")
			if (replacedPairs.has(pairKey)) continue
			this.replaceNode(node, closeNode)
			replacedPairs.add(pairKey)

			// Delete the original node later so we don't mess up the index
			nodesToBeDeleted.add(node.id)
		}

		for (const nodeId of nodesToBeDeleted) {
			this.nodes.remove(nodeId)
		}

		// Rebuild the spatial indexes
		this.nodes.buildSpatialIndex()
		this.ways.buildSpatialIndex()

		return { replaced: replacedPairs.size, deleted: nodesToBeDeleted.size }
	}

	/**
	 * Replace a node in the OSM data with a new node. Remove references to the old node in all ways and relations.
	 * @param oldId The ID of the node to replace.
	 * @param newNode The new node to replace the old node with.
	 * @param mergeTagsAndInfo Whether to merge the tags and info of the old and new nodes or just use the new node.
	 */
	replaceNode(oldNode: OsmNode, newNode: OsmNode, mergeTagsAndInfo = false) {
		// Replace the node in all ways
		for (const way of this.ways) {
			for (let i = 0; i < way.refs.length; i++) {
				if (way.refs[i] === oldNode.id) {
					way.refs[i] = newNode.id
				}
			}
		}

		// Replace the node in all relations
		for (const relation of this.relations) {
			for (let i = 0; i < relation.members.length; i++) {
				const member = relation.members[i]
				if (member == null) continue
				if (member.ref === oldNode.id && member.type === "node") {
					member.ref = newNode.id
				}
			}
		}

		const finalNode = mergeTagsAndInfo
			? {
					...oldNode,
					...newNode,
					tags: {
						...oldNode.tags,
						...newNode.tags,
					},
					info: {
						...oldNode.info,
						...newNode.info,
					},
				}
			: newNode

		// Store the new node in the index
		this.nodes.set(finalNode)
	}

	/**
	 * Find the intersections for a set of ways.
	 * @param wayIds The IDs of the ways to find intersections for.
	 * @returns An object containing the intersections and possible disconnected ways.
	 */
	findIntersectionCandidatesForOsm(osm: Osm) {
		const disconnectedWays = new Set<number>()
		const intersectionCandidates = new UnorderedPairMap<
			GeoJSON.Feature<GeoJSON.Point>[]
		>()

		// Find intersecting way IDs. Each way should have at least one intersecting way or it is disconnected from the rest of the network.
		for (let wayIndex = 0; wayIndex < osm.ways.size; wayIndex++) {
			const wayId = osm.ways.idByIndex.at(wayIndex)
			if (wayId == null) continue
			const lineString = osm.ways.getLineString({ index: wayIndex })
			const intersectingWays = this.findIntersectingWays(lineString)
			if (intersectingWays.size > 0) {
				for (const [intersectingWayId, intersections] of intersectingWays) {
					intersectionCandidates.set(wayId, intersectingWayId, intersections)
				}
			} else if (!this.isWayDisconnected(lineString)) {
				disconnectedWays.add(wayId)
			}
		}

		return {
			intersectionCandidates,
			disconnectedWays,
		}
	}

	/**
	 * Find the IDs of ways that intersect with the given feature.
	 * TODO handle ways with tags indicating they are under or over the current way
	 * @param way
	 * @returns
	 */
	findIntersectingWays(feature: GeoJSON.Feature<GeoJSON.LineString>) {
		const featureBbox = bbox(feature)
		const intersectingWayIndexes = this.ways.intersects(
			featureBbox as GeoBbox2D,
		)
		const intersectingWayIds = new Map<
			number,
			GeoJSON.Feature<GeoJSON.Point>[]
		>()

		for (const intersectingWayIndex of intersectingWayIndexes) {
			const intersectingWayId = this.ways.idByIndex.at(intersectingWayIndex)
			if (
				intersectingWayId !== feature.id &&
				typeof intersectingWayId === "number"
			) {
				const intersectionPoints = lineIntersect(
					feature,
					this.ways.getLineString({ index: intersectingWayIndex }),
				)
				if (intersectionPoints.features.length > 0) {
					intersectingWayIds.set(intersectingWayId, intersectionPoints.features)
				}
			}
		}

		return intersectingWayIds
	}

	isWayDisconnected(wayLineString: GeoJSON.Feature<GeoJSON.LineString>) {
		const featureBbox = bbox(wayLineString)
		const intersectingWayIndexes = this.ways.intersects(
			featureBbox as GeoBbox2D,
		)
		for (const intersectingWayIndex of intersectingWayIndexes) {
			const intersectingWayId = this.ways.idByIndex.at(intersectingWayIndex)
			if (intersectingWayId !== wayLineString.id) {
				const feature = this.ways.getLineString({ index: intersectingWayIndex })
				if (booleanTouches(wayLineString, feature)) return true
				if (
					lineIntersect(
						wayLineString,
						feature as GeoJSON.Feature<GeoJSON.LineString>,
					).features.length > 0
				)
					return false
			}
		}

		return true
	}

	pointToNode(point: GeoJSON.Feature<GeoJSON.Point>): {
		coords: LonLat
		existingNode: OsmNode | null
	} {
		const [lon, lat] = point.geometry.coordinates as [number, number]
		const existingNodeIndex = this.nodes.within(lon, lat)
		const existingNode =
			existingNodeIndex.length > 0
				? this.nodes.getByIndex(existingNodeIndex[0])
				: null
		return {
			coords: { lon, lat },
			existingNode: existingNode ?? null,
		}
	}

	/**
	 * Search along the way for the nearest point to the node and insert the node into the way at the correct position.
	 * Note: both entities must be present in the OSM data. If the node already exists in the way, return false.
	 * @param wayId
	 * @param nodeId
	 */
	insertNodeIntoWay(nodeId: number, wayId: number): boolean {
		const node = this.nodes.getById(nodeId)
		const way = this.ways.getById(wayId)
		if (
			node === null ||
			way === null ||
			wayIsArea(way.refs, way.tags) ||
			way.refs.indexOf(nodeId) !== -1
		)
			return false
		const wayLineString = this.ways.getLineString({ id: wayId })
		const nodePt = [node.lon, node.lat]
		const nearestPoint = nearestPointOnLine(cleanCoords(wayLineString), nodePt)
		this.setEntity({
			...way,
			refs: way.refs.toSpliced(nearestPoint.properties.index, 0, nodeId),
		})
		return true
	}

	/**
	 * Create a deep clone of the OSM data.
	 * TODO clone the indexes and string table directly.
	 * @returns A new Osm object with the same header and entities.
	 */
	clone() {
		const clone = new Osm(this.header)
		for (const node of this.nodes) {
			clone.addEntity(structuredClone(node))
		}
		clone.nodes.finish()
		for (const way of this.ways) {
			clone.addEntity(structuredClone(way))
		}
		clone.ways.finish()
		for (const relation of this.relations) {
			clone.addEntity(structuredClone(relation))
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
