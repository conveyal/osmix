import { geojsonRbush, lineIntersect, nearestPointOnLine } from "@turf/turf"
import NodeSpatialIndex from "./node-spatial-index"
import { generateOsmChanges } from "./osm-change"
import { type OsmPbfReader, createOsmPbfReader } from "./osm-pbf-reader"
import {
	nodesToFeatures,
	wayToFeature,
	wayToLineString,
	waysToFeatures,
} from "./to-geojson"
import type {
	Bbox,
	OsmChange,
	OsmEntityType,
	OsmNode,
	OsmPbfHeaderBlock,
	OsmRelation,
	OsmWay,
} from "./types"
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
		return Osm.fromPbfReader(reader)
	}

	static async fromPbfReader(reader: OsmPbfReader) {
		const osm = new Osm(reader.header)
		for await (const entity of reader) {
			osm.addEntity(entity)
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

	wayToLineString(way: number | OsmWay) {
		return wayToLineString(
			typeof way === "number" ? this.getWay(way) : way,
			(r) => this.getNodePosition(r),
		)
	}

	addNode(node: OsmNode) {
		if (node.id >= this.maxNodeId) this.maxNodeId = node.id
		this.nodes.set(node.id, node)
		return node
	}

	createNode(lon: number, lat: number) {
		return this.addNode({
			id: this.maxNodeId++,
			lon,
			lat,
			type: "node",
		})
	}

	addEntity(entity: OsmNode | OsmWay | OsmRelation | OsmNode[]) {
		if (Array.isArray(entity)) {
			for (const node of entity) {
				this.addNode(node)
			}
			return
		}

		if (entity.type === "node") {
			this.addNode(entity)
		} else if (entity.type === "way") {
			this.ways.set(entity.id, entity)
		} else if (entity.type === "relation") {
			this.relations.set(entity.id, entity)
		}
	}

	getEntity(type: OsmEntityType, id: number) {
		if (type === "node") return this.nodes.get(id)
		if (type === "way") return this.ways.get(id)
		if (type === "relation") return this.relations.get(id)
	}

	deleteEntity(type: OsmEntityType, id: number) {
		if (type === "node") this.nodes.delete(id)
		if (type === "way") this.ways.delete(id)
		if (type === "relation") this.relations.delete(id)
	}

	setEntity(entity: OsmNode | OsmWay | OsmRelation) {
		if (entity.type === "node") this.nodes.set(entity.id, entity)
		if (entity.type === "way") this.ways.set(entity.id, entity)
		if (entity.type === "relation") this.relations.set(entity.id, entity)
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
			this.deleteEntity(change.entityType, change.entityId)
		} else {
			this.setEntity(change.entity)
		}
	}

	applyChanges(changes: OsmChange[]) {
		for (const change of changes) {
			this.applyChange(change)
		}
	}

	/**
	 * Merge all entities from the other OSM into this OSM.
	 * @param other The OSM to merge into this OSM.
	 */
	merge(other: Osm) {
		this.applyChanges(generateOsmChanges(this, other))
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
		const overlapping = this.nodeIndex.findOverlappingNodes(nodes ?? this.nodes)

		// This inner loop can be manually verified in the UI
		for (const [id, overlappingNodes] of overlapping) {
			const baseNode = this.nodes.get(id)
			if (baseNode == null) continue
			for (const overlappingNodeId of overlappingNodes) {
				const patchNode = this.nodes.get(overlappingNodeId)
				if (patchNode == null) continue
				this.replaceNode(id, {
					...patchNode,
					tags: {
						...baseNode.tags,
						...patchNode.tags,
					},
					info: {
						...baseNode.info,
						...patchNode.info,
					},
				})
			}
			this.nodes.delete(id)
		}
	}

	/**
	 * Replace a node in the OSM data with a new node. Remove references to the old node in all ways and relations.
	 * @param oldId The ID of the node to replace.
	 * @param newNode The new node to replace the old node with.
	 */
	replaceNode(oldId: number, newNode: OsmNode) {
		// Replace the node in all ways
		for (const way of this.ways.values()) {
			for (let i = 0; i < way.refs.length; i++) {
				if (way.refs[i] === oldId) {
					way.refs[i] = newNode.id
				}
			}
		}

		// Replace the node in all relations
		for (const relation of this.relations.values()) {
			for (let i = 0; i < relation.members.length; i++) {
				const member = relation.members[i]
				if (member == null) continue
				if (member.ref === oldId && member.type === "node") {
					member.ref = newNode.id
				}
			}
		}

		// Ensure the new node is in the index
		this.nodes.set(newNode.id, newNode)
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
	 * Find the IDs of ways that intersect with the given way.
	 * @param way
	 * @returns
	 */
	findIntersectingWayIds(way: number | OsmWay) {
		const wayLineString = this.wayToLineString(way)
		const intersectingWays = this.wayIndex.search(wayLineString)
		const intersectingIds = new Set<number>()

		for (const intersectingWay of intersectingWays.features) {
			if (
				intersectingWay.id !== wayLineString.id &&
				typeof intersectingWay.id === "number"
			) {
				intersectingIds.add(intersectingWay.id)
			}
		}

		return intersectingIds
	}

	findIntersectingPoints(way1: number | OsmWay, way2: number | OsmWay) {
		const way1LineString = this.wayToLineString(way1)
		const way2LineString = this.wayToLineString(way2)
		const intersectingPoints = lineIntersect(way1LineString, way2LineString)
		return intersectingPoints.features
	}

	/**
	 * Search along the way for the nearest point to the node and insert the node into the way at the correct position.
	 * @param wayId
	 * @param nodeId
	 */
	insertNodeIntoWay(wayId: number, nodeId: number): boolean {
		const way = this.getWay(wayId)
		if (wayIsArea(way.refs, way.tags) || way.refs.indexOf(nodeId) !== -1)
			return false
		const node = this.getNode(nodeId)
		const nearestPoint = nearestPointOnLine(
			wayToLineString(way, (r) => this.getNodePosition(r)),
			[node.lon, node.lat],
		)
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
}
