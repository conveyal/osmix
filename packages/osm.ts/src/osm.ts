import { type OsmPbfReader, createOsmPbfReader } from "./osm-pbf-reader"
import { nodesToFeatures, waysToFeatures } from "./to-geojson"
import type {
	Bbox,
	OsmNode,
	OsmPbfHeaderBlock,
	OsmRelation,
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

	addEntity(entity: OsmNode | OsmWay | OsmRelation | OsmNode[]) {
		if (Array.isArray(entity)) {
			for (const node of entity) {
				this.addEntity(node)
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

	toGeoJSON() {
		return [
			...nodesToFeatures(this.nodes),
			...waysToFeatures(this.ways, this.nodes),
		]
	}
}
