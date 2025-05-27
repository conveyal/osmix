import KDBush from "kdbush"
import type { OsmPbfHeaderBlock } from "./proto/osmformat"
import { nodesToFeatures, waysToFeatures } from "./to-geojson"
import type { Bbox, OsmNode, OsmRelation, OsmWay } from "./types"

export class Osm {
	header: OsmPbfHeaderBlock
	nodes: Map<number, OsmNode> = new Map()
	ways: Map<number, OsmWay> = new Map()
	relations: Map<number, OsmRelation> = new Map()

	constructor(header: OsmPbfHeaderBlock) {
		this.header = header
	}

	addEntity(entity: OsmNode | OsmWay | OsmRelation) {
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

	createSpatialIndex() {
		const index = new KDBush(this.nodes.size)
		for (const node of this.nodes.values()) {
			index.add(node.lon, node.lat)
		}
		index.finish()
		return index
	}
}
