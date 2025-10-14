import type { LineString, MultiPolygon, Point, Polygon } from "geojson"
import type { OsmixGeoJSONFeature, OsmNode, OsmRelation, OsmWay } from "./types"
import { wayIsArea } from "./way-is-area"

export function nodeToFeature(node: OsmNode): OsmixGeoJSONFeature<Point> {
	return {
		type: "Feature",
		id: `node/${node.id}`,
		geometry: {
			type: "Point",
			coordinates: [node.lon, node.lat],
		},
		properties: {
			id: node.id,
			type: "node",
			tags: node.tags,
			info: node.info,
		},
	}
}

export function wayToFeature(
	way: OsmWay,
	refToPosition: (id: number) => [number, number],
): OsmixGeoJSONFeature<LineString | Polygon> {
	return {
		type: "Feature",
		id: `way/${way.id}`,
		geometry: wayIsArea(way)
			? {
					type: "Polygon",
					coordinates: [way.refs.map((r) => refToPosition(r))],
				}
			: {
					type: "LineString",
					coordinates: way.refs.map((r) => refToPosition(r)),
				},
		properties: {
			id: way.id,
			type: "way",
			tags: way.tags,
			info: way.info,
		},
	}
}

export function relationToFeature(
	relation: OsmRelation,
	refToPosition: (id: number) => [number, number],
): OsmixGeoJSONFeature<MultiPolygon> {
	return {
		type: "Feature",
		id: `relation/${relation.id}`,
		geometry: {
			type: "MultiPolygon",
			coordinates: [
				[relation.members.map((member) => refToPosition(member.ref))],
			],
		},
		properties: {
			id: relation.id,
			type: "relation",
			tags: relation.tags,
			info: relation.info,
		},
	}
}
