import type { OsmPbfReader } from "./osm-pbf-reader"
import type {
	OsmGeoJSONProperties,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./types"
import { wayIsArea } from "./way-is-area"

export async function* generateGeoJsonFromOsmPbfReader(
	osmReader: OsmPbfReader,
) {
	const nodes: Map<number, OsmNode> = new Map()
	for await (const entity of osmReader) {
		if (Array.isArray(entity)) {
			for (const node of entity) {
				nodes.set(node.id, node)
				if (node.tags && Object.keys(node.tags).length > 0) {
					yield nodeToFeature(node)
				}
			}
		} else if (entity.type === "way") {
			yield wayToFeature(entity, nodes)
		}
	}
}

export function entitiesToGeoJSON(osm: {
	nodes: Map<number, OsmNode>
	ways: Map<number, OsmWay>
}) {
	return [...nodesToFeatures(osm.nodes), ...waysToFeatures(osm.ways, osm.nodes)]
}

function includeNode(node: OsmNode) {
	if (!node.tags || Object.keys(node.tags).length === 0) return false
	return true
}

export function nodesToFeatures(
	nodes: Map<number, OsmNode>,
	filter = includeNode,
) {
	return Array.from(nodes.values().filter(filter)).map(nodeToFeature)
}

export function nodeToFeature(
	node: OsmNode,
): GeoJSON.Feature<GeoJSON.Point, OsmGeoJSONProperties> {
	return {
		type: "Feature",
		id: node.id,
		geometry: {
			type: "Point",
			coordinates: [node.lon, node.lat],
		},
		properties: node.tags ?? {},
	}
}

function includeWay(way: OsmWay) {
	if (!way.tags || Object.keys(way.tags).length === 0) return false
	return true
}

export function waysToFeatures(
	ways: Map<number, OsmWay>,
	nodes: Map<number, OsmNode>,
	filter = includeWay,
) {
	return Array.from(ways.values().filter(filter))
		.map((way) => wayToFeature(way, nodes))
		.filter((f) => f.geometry.type !== "Polygon")
}

export function wayToFeature(
	way: OsmWay,
	nodes: Map<number, OsmNode>,
): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon, OsmGeoJSONProperties> {
	const getNode = (r: number) => {
		const n = nodes.get(r)
		if (!n) throw new Error(`Node ${r} not found`)
		return [n.lon, n.lat]
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
		properties: way.tags ?? {},
	}
}

export function wayToLineString(
	way: OsmWay,
	refToPosition: (r: number) => [number, number],
): GeoJSON.Feature<GeoJSON.LineString, OsmGeoJSONProperties> {
	return {
		type: "Feature",
		id: way.id,
		geometry: {
			type: "LineString",
			coordinates: way.refs.map(refToPosition),
		},
		properties: way.tags ?? {},
	}
}

export function wayToEditableGeoJson(
	way: OsmWay,
	nodes: Map<number, OsmNode>,
): GeoJSON.FeatureCollection<
	GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.Point,
	OsmGeoJSONProperties
> {
	const getNode = (r: number) => {
		const n = nodes.get(r)
		if (!n) throw new Error(`Node ${r} not found`)
		return n
	}
	const wayFeature = wayToFeature(way, nodes)
	const wayNodes = way.refs.map((id) => {
		const node = getNode(id)
		return nodeToFeature(node)
	})

	return {
		type: "FeatureCollection",
		features: [wayFeature, ...wayNodes],
	}
}

export function relationToFeature(
	relation: OsmRelation,
	nodes: Map<number, OsmNode>,
): GeoJSON.Feature<GeoJSON.Polygon, OsmGeoJSONProperties> {
	return {
		type: "Feature",
		id: relation.id,
		geometry: {
			type: "Polygon",
			coordinates: [
				relation.members.map((member, i) => {
					// const type = member.type
					const node = nodes.get(member.ref)
					if (!node) throw new Error(`Node ${member.ref} not found`)
					return [node.lon, node.lat]
				}),
			],
		},
		properties: relation.tags ?? {},
	}
}
