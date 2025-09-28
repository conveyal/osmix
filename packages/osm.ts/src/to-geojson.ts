import type { Nodes } from "./nodes"
import type { Osm } from "./osm"
import type {
	OsmGeoJSONProperties,
	OsmNode,
	OsmRelation,
	OsmTags,
	OsmWay,
} from "./types"
import { isNode, isRelation, isWay } from "./utils"
import { wayIsArea } from "./way-is-area"
import type { Ways } from "./ways"

export function getEntityGeoJson(
	entity: OsmNode | OsmWay | OsmRelation,
	osm: Osm,
): GeoJSON.Feature<GeoJSON.Geometry, OsmTags> {
	if (isNode(entity)) {
		return nodeToFeature(entity)
	}
	if (isWay(entity)) {
		return wayToFeature(entity, osm.nodes)
	}
	if (isRelation(entity)) {
		return relationToFeature(entity, osm.nodes)
	}
	throw new Error("Unknown entity type")
}

function includeNode(node: OsmNode) {
	if (!node.tags || Object.keys(node.tags).length === 0) return false
	return true
}

export function nodesToFeatures(nodes: Nodes, filter = includeNode) {
	const features: GeoJSON.Feature<GeoJSON.Point, OsmGeoJSONProperties>[] = []
	for (const node of nodes) {
		if (filter(node)) {
			features.push(nodeToFeature(node))
		}
	}
	return features
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

export function waysToFeatures(ways: Ways, nodes: Nodes, filter = includeWay) {
	const features: GeoJSON.Feature<
		GeoJSON.LineString | GeoJSON.Polygon,
		OsmGeoJSONProperties
	>[] = []
	for (const way of ways) {
		if (filter(way)) {
			features.push(wayToFeature(way, nodes))
		}
	}
	return features
}

export function wayToFeature(
	way: OsmWay,
	nodes: Nodes,
): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon, OsmGeoJSONProperties> {
	return {
		type: "Feature",
		id: way.id,
		geometry: wayIsArea(way.refs, way.tags)
			? {
					type: "Polygon",
					coordinates: [way.refs.map((r) => nodes.getNodeLonLat({ id: r }))],
				}
			: {
					type: "LineString",
					coordinates: way.refs.map((r) => nodes.getNodeLonLat({ id: r })),
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
	nodes: Nodes,
): GeoJSON.FeatureCollection<
	GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.Point,
	OsmGeoJSONProperties
> {
	const getNode = (r: number) => {
		const n = nodes.getById(r)
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
	nodes: Nodes,
): GeoJSON.Feature<
	GeoJSON.GeometryCollection<
		GeoJSON.Polygon | GeoJSON.Point | GeoJSON.LineString
	>,
	OsmGeoJSONProperties
> {
	return {
		type: "Feature",
		id: relation.id,
		geometry: {
			type: "GeometryCollection",
			geometries: [
				{
					type: "Polygon",
					coordinates: [
						relation.members.map((member) =>
							nodes.getNodeLonLat({ id: member.ref }),
						),
					],
				},
			],
		},
		properties: relation.tags ?? {},
	}
}
