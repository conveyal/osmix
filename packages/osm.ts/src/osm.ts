import {
	bbox,
	booleanTouches,
	cleanCoords,
	geojsonRbush,
	lineIntersect,
	nearestPointOnLine,
} from "@turf/turf"
import NodeSpatialIndex from "./node-spatial-index"
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
	wayToLineString,
	waysToFeatures,
} from "./to-geojson"
import type {
	Bbox,
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

/**
 * Requires sorted IDs.
 */
export class Osm {
	header: OsmPbfHeaderBlock
	nodes: Map<number, OsmNode> = new Map()
	ways: Map<number, OsmWay> = new Map()
	relations: Map<number, OsmRelation> = new Map()

	maxNodeId = 0

	static async fromPbfData(data: ArrayBuffer | ReadableStream<Uint8Array>) {
		const reader = await createOsmPbfReader(data)
		return Osm.fromPbfReader(reader.header, reader.blocks)
	}

	static async fromPbfReader(
		header: OsmPbfHeaderBlock,
		blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
	) {
		const osm = new Osm(header)
		for await (const block of blocks) {
			const blockParser = new PrimitiveBlockParser(block)
			for (const entity of blockParser) {
				osm.addEntity(entity)
			}
		}
		return osm
	}

	constructor(header?: OsmPbfHeaderBlock) {
		this.header = header ?? {
			required_features: [],
			optional_features: [],
		}
	}

	getNode(id: number) {
		const node = this.nodes.get(id)
		if (!node) throw new Error(`Node ${id} not found`)
		return node
	}

	getNodePosition(id: number): [number, number] {
		const node = this.getNode(id)
		return [node.lon, node.lat]
	}

	getWay(id: number): OsmWay {
		const way = this.ways.get(id)
		if (!way) throw Error(`Way ${id} not found`)
		return way
	}

	wayToLineString(way: number) {
		return wayToLineString(
			typeof way === "number" ? this.getWay(way) : way,
			(r) => this.getNodePosition(r),
		)
	}

	getEntityBbox(entity: OsmNode | OsmWay | OsmRelation): Bbox {
		if (isNode(entity)) {
			return bbox(nodeToFeature(entity)) as Bbox
		}
		if (isWay(entity)) {
			return bbox(wayToFeature(entity, this.nodes)) as Bbox
		}
		if (isRelation(entity)) {
			return bbox(relationToFeature(entity, this.nodes)) as Bbox
		}
		throw new Error("Unknown entity type")
	}

	addNode(node: OsmNode) {
		if (node.id >= this.maxNodeId) this.maxNodeId = node.id
		this.nodes.set(node.id, node)
		return node
	}

	createNode(lonLat: LonLat) {
		return this.addNode({
			id: this.maxNodeId++,
			...lonLat,
		})
	}

	addEntity(entity: OsmNode | OsmWay | OsmRelation | OsmNode[]) {
		if (Array.isArray(entity)) {
			for (const node of entity) {
				this.addNode(node)
			}
			return
		}

		if (isNode(entity)) {
			this.addNode(entity)
		} else if (isWay(entity)) {
			this.ways.set(entity.id, entity)
		} else if (isRelation(entity)) {
			this.relations.set(entity.id, entity)
		}
	}

	getEntity(type: OsmEntityType, id: number) {
		if (type === "node") return this.nodes.get(id)
		if (type === "way") return this.ways.get(id)
		if (type === "relation") return this.relations.get(id)
	}

	deleteEntity(entity: OsmNode | OsmWay | OsmRelation) {
		if (isNode(entity)) this.nodes.delete(entity.id)
		if (isWay(entity)) this.ways.delete(entity.id)
		if (isRelation(entity)) this.relations.delete(entity.id)
	}

	setEntity(entity: OsmNode | OsmWay | OsmRelation) {
		if (isNode(entity)) this.nodes.set(entity.id, entity)
		if (isWay(entity)) this.ways.set(entity.id, entity)
		if (isRelation(entity)) this.relations.set(entity.id, entity)
	}

	bbox(): Bbox {
		if (this.header.bbox)
			return [
				this.header.bbox.left,
				this.header.bbox.bottom,
				this.header.bbox.right,
				this.header.bbox.top,
			]
		const bbox: Bbox = [
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]
		for (const node of this.nodes.values()) {
			if (node.lon < bbox[0]) bbox[0] = node.lon
			if (node.lat < bbox[1]) bbox[1] = node.lat
			if (node.lon > bbox[2]) bbox[2] = node.lon
			if (node.lat > bbox[3]) bbox[3] = node.lat
		}
		return bbox
	}

	toGeoJSON(nodeFilter?: (node: OsmNode) => boolean) {
		return [
			...nodesToFeatures(this.nodes, nodeFilter),
			...waysToFeatures(this.ways, this.nodes),
		]
	}

	wayToGeoJson(wayId: number) {
		const way = this.ways.get(wayId)
		if (!way) return null
		return wayToFeature(way, this.nodes)
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
		this.loadNodeSpatialIndex()
		this.loadWaySpatialIndex()
	}

	#nodeSpatialIndex: NodeSpatialIndex | null = null
	loadNodeSpatialIndex() {
		this.#nodeSpatialIndex = new NodeSpatialIndex(this.nodes)
		return this.#nodeSpatialIndex
	}
	get nodeIndex() {
		if (this.#nodeSpatialIndex == null) {
			return this.loadNodeSpatialIndex()
		}
		return this.#nodeSpatialIndex
	}

	/**
	 * Deduplicate nodes by merging overlapping nodes.
	 * @param nodes The nodes to check for deduplication. If not provided, all nodes will be checked.
	 */
	dedupeOverlappingNodes(nodes?: Map<number, OsmNode>) {
		const nodesToBeDeleted = new Set<number>()
		const replacedPairs = new Set<string>()
		for (const [nodeId] of nodes ?? this.nodes) {
			const node = this.getNode(nodeId)
			const closeNodes = this.nodeIndex.findNeighborsWithin(node, 0)
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
			this.deleteEntity(this.getNode(nodeId))
		}

		// Rebuild the spatial indexes
		this.loadNodeSpatialIndex()
		this.loadWaySpatialIndex()

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
		for (const way of this.ways.values()) {
			for (let i = 0; i < way.refs.length; i++) {
				if (way.refs[i] === oldNode.id) {
					way.refs[i] = newNode.id
				}
			}
		}

		// Replace the node in all relations
		for (const relation of this.relations.values()) {
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
		this.nodes.set(finalNode.id, finalNode)
	}

	#waySpatialIndex: ReturnType<typeof geojsonRbush> | null = null
	loadWaySpatialIndex() {
		console.time("osm.loadWaySpatialIndex")
		this.#waySpatialIndex = geojsonRbush()
		const ways = Array.from(this.ways.values()).map((w) =>
			wayToLineString(w, (r) => this.getNodePosition(r)),
		)
		this.#waySpatialIndex.load(ways)
		console.timeEnd("osm.loadWaySpatialIndex")
		return this.#waySpatialIndex
	}
	get wayIndex() {
		if (this.#waySpatialIndex == null) {
			return this.loadWaySpatialIndex()
		}
		return this.#waySpatialIndex
	}

	/**
	 * Find the intersections for a set of ways.
	 * @param wayIds The IDs of the ways to find intersections for.
	 * @returns An object containing the intersections and possible disconnected ways.
	 */
	findIntersectionCandidatesForWays(ways: Map<number, OsmWay>) {
		const disconnectedWays = new Set<number>()
		const intersectionCandidates = new UnorderedPairMap<
			GeoJSON.Feature<GeoJSON.Point>[]
		>()

		// Find intersecting way IDs. Each way should have at least one intersecting way or it is disconnected from the rest of the network.
		for (const [wayId] of ways) {
			const lineString = this.wayToLineString(wayId)
			const intersectingWays = this.findIntersectingWays(lineString)
			if (intersectingWays.size > 0) {
				for (const [intersectingWayId, intersections] of intersectingWays) {
					intersectionCandidates.set(wayId, intersectingWayId, intersections)
				}
			} else if (!this.isWayDisconnected(wayId)) {
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
		// const feature = this.wayToLineString(wayId)
		const { features } = this.wayIndex.search(feature)
		const intersectingWayIds = new Map<
			number,
			GeoJSON.Feature<GeoJSON.Point>[]
		>()

		for (const intersectingWay of features) {
			if (
				intersectingWay.id !== feature.id &&
				typeof intersectingWay.id === "number"
			) {
				const intersections = lineIntersect(
					feature,
					intersectingWay as GeoJSON.Feature<GeoJSON.LineString>,
				)
				if (intersections.features.length > 0) {
					intersectingWayIds.set(intersectingWay.id, intersections.features)
				}
			}
		}

		return intersectingWayIds
	}

	isWayDisconnected(wayId: number) {
		const wayLineString = this.wayToLineString(wayId)
		const { features } = this.wayIndex.search(wayLineString)
		for (const feature of features) {
			if (feature.id !== wayId) {
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

	findIntersectingPoints(wayId1: number, wayId2: number) {
		const way1LineString = this.wayToLineString(wayId1)
		const way2LineString = this.wayToLineString(wayId2)
		return lineIntersect(way1LineString, way2LineString).features
	}

	pointToNode(point: GeoJSON.Feature<GeoJSON.Point>): {
		coords: LonLat
		existingNode: OsmNode | null
	} {
		const [lon, lat] = point.geometry.coordinates as [number, number]
		const existingNode = this.nodeIndex.nodesWithin(lon, lat)[0]
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
		const node = this.getNode(nodeId)
		const way = this.getWay(wayId)
		if (wayIsArea(way.refs, way.tags) || way.refs.indexOf(nodeId) !== -1)
			return false
		const wayLineString = this.wayToLineString(wayId)
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
	 * @returns A new Osm object with the same header and entities.
	 */
	clone() {
		const clone = new Osm(this.header)
		for (const node of this.nodes.values()) {
			clone.addEntity(structuredClone(node))
		}
		for (const way of this.ways.values()) {
			clone.addEntity(structuredClone(way))
		}
		for (const relation of this.relations.values()) {
			clone.addEntity(structuredClone(relation))
		}
		return clone
	}

	/**
	 * Generate primitive blocks from this OSM object for writing to a PBF file.
	 *
	 * TODO: Sort nodes and ways?
	 * @returns a generator that produces primitive blocks
	 */
	async *generatePbfPrimitiveBlocks(): AsyncGenerator<OsmPbfPrimitiveBlock> {
		const nodes = Array.from(this.nodes.values())
		for (let i = 0; i < nodes.length; i += MAX_ENTITIES_PER_BLOCK) {
			const block = new PrimitiveBlockBuilder()
			block.addDenseNodes(nodes.slice(i, i + MAX_ENTITIES_PER_BLOCK))
			yield block
		}

		let block = new PrimitiveBlockBuilder()
		for (const [, way] of this.ways) {
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
		for (const [, relation] of this.relations) {
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
