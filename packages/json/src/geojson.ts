import type { OsmNode, OsmRelation, OsmTags, OsmWay } from "./types"
import { wayIsArea } from "./way-is-area"

export type OsmGeoJSONFeature = GeoJSON.Feature<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
	OsmTags
>

export function nodeToFeature(
	node: OsmNode,
): GeoJSON.Feature<GeoJSON.Point, OsmTags> {
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

export function wayToFeature(
	way: OsmWay,
	refToPosition: (id: number) => [number, number],
): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon, OsmTags> {
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

export function relationToFeature(
	relation: OsmRelation,
	refToPosition: (id: number) => [number, number],
): GeoJSON.Feature<
	GeoJSON.GeometryCollection<
		GeoJSON.Polygon | GeoJSON.Point | GeoJSON.LineString
	>,
	OsmTags
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
