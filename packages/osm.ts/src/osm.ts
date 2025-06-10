import { bbox } from "@turf/turf"
import KDBush from "kdbush"
import { type OsmPbfReader, createOsmPbfReader } from "./osm-pbf-reader"
import {
	nodesToFeatures,
	wayToEditableGeoJson,
	wayToFeature,
	waysToFeatures,
} from "./to-geojson"
import type {
	Bbox,
	OsmGeoJSONProperties,
	OsmNode,
	OsmPbfHeaderBlock,
	OsmRelation,
	OsmTags,
	OsmWay,
} from "./types"

/**
 * Requires sorted IDs.
 */
export class Osm {
	header: OsmPbfHeaderBlock
	nodes: Map<number, OsmNode> = new Map()
	ways: Map<number, OsmWay> = new Map()
	relations: Map<number, OsmRelation> = new Map()

	// For generating a spatial index
	nodeIds: number[] = []

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

	constructor(header: OsmPbfHeaderBlock) {
		this.header = header
	}

	way(id: number) {
		const way = this.ways.get(id)
		if (!way) return null
		return new Way(this, way)
	}

	addEntity(entity: OsmNode | OsmWay | OsmRelation | OsmNode[]) {
		if (Array.isArray(entity)) {
			for (const node of entity) {
				this.addEntity(node)
				this.nodeIds.push(node.id)
			}
			return
		}

		if (entity.type === "node") {
			this.nodes.set(entity.id, entity)
		} else if (entity.type === "way") {
			this.ways.set(entity.id, entity)
		} else if (entity.type === "relation") {
			this.relations.set(entity.id, entity)
		}
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

	#nodeSpatialIndex: KDBush | null = null
	get nodeSpatialIndex() {
		if (!this.#nodeSpatialIndex) {
			console.time("osm.ts: nodeIndex")
			this.#nodeSpatialIndex = new KDBush(this.nodeIds.length)
			for (const nodeId of this.nodeIds) {
				const node = this.nodes.get(nodeId)
				if (!node) continue
				this.#nodeSpatialIndex.add(node.lon, node.lat)
			}
			this.#nodeSpatialIndex.finish()
			console.timeEnd("osm.ts: nodeIndex")
		}
		return this.#nodeSpatialIndex
	}

	nodeIndexToNode(index: number) {
		const id = this.nodeIds[index]
		if (id == null) throw new Error("Node ID is null")
		const node = this.nodes.get(id)
		if (!node) throw new Error("Node not found")
		return node
	}

	nodesWithin(x: number, y: number, radius: number) {
		const ids = this.nodeSpatialIndex.within(x, y, radius)
		return ids.map((i) => this.nodeIndexToNode(i))
	}

	nodesWithinBbox(bbox: Bbox) {
		const ids = this.nodeSpatialIndex.range(bbox[0], bbox[1], bbox[2], bbox[3])
		return ids.map((i) => this.nodeIndexToNode(i))
	}
}

class Way implements OsmWay {
	id: number
	refs: number[]
	tags: OsmTags
	type: OsmWay["type"] = "way"

	#osm: Osm

	constructor(osm: Osm, way: OsmWay) {
		this.id = way.id
		this.refs = way.refs
		this.tags = way.tags ?? {}
		this.#osm = osm
	}

	#geojson: GeoJSON.FeatureCollection<
		GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.Point,
		OsmGeoJSONProperties
	> | null = null
	get geojson() {
		if (!this.#geojson) {
			this.#geojson = wayToEditableGeoJson(this, this.#osm.nodes)
		}
		return this.#geojson
	}

	#bbox: Bbox | null = null
	get bbox() {
		if (!this.#bbox) {
			this.#bbox = bbox(this.geojson) as Bbox
		}
		return this.#bbox
	}
}
