import {
	type ReadOptions,
	parseDenseNodes,
	parseNode,
	parseWay,
} from "./read-osm-pbf-blocks"
import type {
	Bbox,
	OsmNode,
	OsmPbfInfoParsed,
	OsmPbfPrimitiveBlock,
	OsmTags,
	OsmWay,
} from "./types"
import { wayIsArea } from "./way-is-area"

type OsmProperties = {
	info?: OsmPbfInfoParsed
	tags?: OsmTags
}

export type OsmGeoJSONFeature = GeoJSON.Feature<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
	OsmProperties
>

export async function blocksToGeoJSON(
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
	opts?: ReadOptions,
): Promise<{
	generateFeatures: AsyncGenerator<
		GeoJSON.Feature<
			GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
			OsmProperties
		>
	>
	bbox: Bbox
}> {
	const nodes: Map<number, [number, number]> = new Map()
	const bbox: Bbox = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]
	const updateBbox = (node: OsmNode) => {
		bbox[0] = Math.min(bbox[0], node.lon)
		bbox[1] = Math.min(bbox[1], node.lat)
		bbox[2] = Math.max(bbox[2], node.lon)
		bbox[3] = Math.max(bbox[3], node.lat)
	}

	async function* generateFeatures() {
		for await (const block of blocks) {
			for (const group of block.primitivegroup) {
				for (const n of group.nodes) {
					const node = parseNode(n, block, opts)
					nodes.set(n.id, [node.lon, node.lat])
					updateBbox(node)
					if (n.keys.length > 0) {
						yield nodeToFeature(node)
					}
				}
				if (group.dense) {
					for (const n of parseDenseNodes(group.dense, block, opts)) {
						nodes.set(n.id, [n.lon, n.lat])
						updateBbox(n)
						if (n.tags && Object.keys(n.tags).length > 0) {
							yield nodeToFeature(n)
						}
					}
				}
				if (group.ways) {
					for (const w of group.ways) {
						yield wayToFeature(parseWay(w, block, opts), nodes)
					}
				}
			}
		}
	}

	return {
		generateFeatures: generateFeatures(),
		bbox,
	}
}

function nodeToFeature(
	node: OsmNode,
): GeoJSON.Feature<GeoJSON.Point, OsmProperties> {
	return {
		type: "Feature",
		id: node.id,
		geometry: {
			type: "Point",
			coordinates: [node.lon, node.lat],
		},
		properties: {
			info: node.info,
			tags: node.tags,
		},
	}
}

function wayToFeature(
	way: OsmWay,
	nodes: Map<number, [number, number]>,
): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon, OsmProperties> {
	const getNode = (r: number) => {
		const n = nodes.get(r)
		if (!n) throw new Error(`Node ${r} not found`)
		return n
	}
	return {
		type: "Feature",
		id: way.id,
		geometry: wayIsArea(way.refs, way.tags)
			? {
					type: "Polygon",
					coordinates: [way.refs.map(getNode)],
				}
			: {
					type: "LineString",
					coordinates: way.refs.map(getNode),
				},
		properties: {
			info: way.info,
			tags: way.tags,
		},
	}
}
