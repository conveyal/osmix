import type { LonLat, OsmNode, OsmRelation, OsmWay } from "@osmix/shared/types"
import type { LineString, MultiPolygon, Point, Polygon } from "geojson"
import {
	buildRelationRings,
	getWayMembersByRole,
	isMultipolygonRelation,
} from "./relation-multipolygon"
import type { OsmGeoJSONFeature } from "./types"
import { wayIsArea } from "./way-is-area"

export function nodeToFeature(node: OsmNode): OsmGeoJSONFeature<Point> {
	return {
		type: "Feature",
		id: node.id,
		geometry: {
			type: "Point",
			coordinates: [node.lon, node.lat],
		},
		properties: {
			id: node.id,
			type: "node",
			...node.info,
			...node.tags,
		},
	}
}

export function wayToFeature(
	way: OsmWay,
	refToPosition: (id: number) => [number, number],
): OsmGeoJSONFeature<LineString | Polygon> {
	return {
		type: "Feature",
		id: way.id,
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
			...way.info,
			...way.tags,
		},
	}
}

export function relationToFeature(
	relation: OsmRelation,
	refToPosition: (id: number) => [number, number],
	getWay?: (wayId: number) => OsmWay | null,
): OsmGeoJSONFeature<Polygon | MultiPolygon> {
	// Handle multipolygon relations
	if (isMultipolygonRelation(relation) && getWay) {
		const getNodeCoordinates = (nodeId: number): LonLat | undefined => {
			const pos = refToPosition(nodeId)
			return pos ? [pos[0], pos[1]] : undefined
		}

		const rings = buildRelationRings(relation, getWay, getNodeCoordinates)

		if (rings.length === 0) {
			// Fallback to simple MultiPolygon if we can't build rings
			return {
				type: "Feature",
				id: relation.id,
				geometry: {
					type: "MultiPolygon",
					coordinates: [],
				},
				properties: {
					id: relation.id,
					type: "relation",
					...relation.info,
					...relation.tags,
				},
			}
		}

		// If only one polygon, return Polygon; otherwise MultiPolygon
		if (rings.length === 1) {
			return {
				type: "Feature",
				id: relation.id,
				geometry: {
					type: "Polygon",
					coordinates: rings[0]!,
				},
				properties: {
					id: relation.id,
					type: "relation",
					...relation.info,
					...relation.tags,
				},
			}
		}

		return {
			type: "Feature",
			id: relation.id,
			geometry: {
				type: "MultiPolygon",
				coordinates: rings,
			},
			properties: {
				id: relation.id,
				type: "relation",
				...relation.info,
				...relation.tags,
			},
		}
	}

	// Fallback for non-multipolygon relations or when getWay is not provided
	// Group members by type and create a simple representation
	const { outer } = getWayMembersByRole(relation)
	const coordinates: [number, number][][][] = []

	// Add outer members as coordinates
	if (outer.length > 0) {
		coordinates.push([outer.map((member) => refToPosition(member.ref))])
	}

	return {
		type: "Feature",
		id: relation.id,
		geometry: {
			type: "MultiPolygon",
			coordinates: coordinates.length > 0 ? coordinates : [],
		},
		properties: {
			id: relation.id,
			type: "relation",
			...relation.info,
			...relation.tags,
		},
	}
}
