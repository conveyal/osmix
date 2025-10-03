import type { OsmNode, OsmRelation, OsmWay } from "@osmix/json"
import type { OsmGeoJSONProperties } from "./types"
import { wayIsArea } from "./way-is-area"

function includeNode(node: OsmNode) {
	if (!node.tags || Object.keys(node.tags).length === 0) return false
	return true
}

export function nodesToFeatures(
	nodes: Iterable<OsmNode>,
	filter = includeNode,
) {
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

export function waysToFeatures(
	ways: Iterable<OsmWay>,
	refToPosition: (id: number) => [number, number],
	filter = includeWay,
) {
	const features: GeoJSON.Feature<
		GeoJSON.LineString | GeoJSON.Polygon,
		OsmGeoJSONProperties
	>[] = []
	for (const way of ways) {
		if (filter(way)) {
			features.push(wayToFeature(way, refToPosition))
		}
	}
	return features
}

export function wayToFeature(
	way: OsmWay,
	refToPosition: (id: number) => [number, number],
): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon, OsmGeoJSONProperties> {
	return {
		type: "Feature",
		id: way.id,
		geometry: wayIsArea(way.refs, way.tags)
			? {
					type: "Polygon",
					coordinates: [way.refs.map((r) => refToPosition(r))],
				}
			: {
					type: "LineString",
					coordinates: way.refs.map((r) => refToPosition(r)),
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
	refToNode: (id: number) => OsmNode,
): GeoJSON.FeatureCollection<
	GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.Point,
	OsmGeoJSONProperties
> {
	const getNode = (r: number) => {
		const n = refToNode(r)
		if (!n) throw new Error(`Node ${r} not found`)
		return n
	}
	const wayFeature = wayToFeature(way, (ref) => {
		const node = refToNode(ref)
		return [node.lon, node.lat]
	})
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
	refToPosition: (id: number) => [number, number],
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
						relation.members.map((member) => refToPosition(member.ref)),
					],
				},
			],
		},
		properties: relation.tags ?? {},
	}
}
