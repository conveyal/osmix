import {
	type ReadOptions,
	parseDenseNodes,
	parseNode,
	parseWay,
} from "./read-osm-pbf-blocks"
import type {
	OsmNode,
	OsmPbfInfoParsed,
	OsmPbfPrimitiveBlock,
	OsmTags,
	OsmWay,
} from "./types"

type OsmProperties = {
	info?: OsmPbfInfoParsed
	tags?: OsmTags
}

export type OsmGeoJSONFeature = GeoJSON.Feature<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
	OsmProperties
>

export async function* blocksToGeoJSON(
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
	opts?: ReadOptions,
): AsyncGenerator<
	GeoJSON.Feature<
		GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
		OsmProperties
	>
> {
	const nodes: Map<number, [number, number]> = new Map()
	for await (const block of blocks) {
		for (const group of block.primitivegroup) {
			for (const n of group.nodes) {
				const node = parseNode(n, block, opts)
				nodes.set(n.id, [node.lon, node.lat])
				if (n.keys.length > 0) {
					yield nodeToFeature(node)
				}
			}
			if (group.dense) {
				for (const n of parseDenseNodes(group.dense, block, opts)) {
					nodes.set(n.id, [n.lon, n.lat])
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
	const bbox: GeoJSON.BBox = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]
	const getNode = (r: number) => {
		const n = nodes.get(r)
		if (!n) throw new Error(`Node ${r} not found`)
		bbox[0] = Math.min(bbox[0], n[0])
		bbox[1] = Math.min(bbox[1], n[1])
		bbox[2] = Math.max(bbox[2], n[0])
		bbox[3] = Math.max(bbox[3], n[1])
		return n
	}
	return {
		type: "Feature",
		id: way.id,
		bbox,
		geometry:
			way.refs[0] === way.refs[way.refs.length - 1]
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
