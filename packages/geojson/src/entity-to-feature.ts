import type { Osm } from "@osmix/core"
import {
	buildRelationLineStrings,
	collectRelationPoints,
	getRelationKind,
	isAreaRelation,
} from "@osmix/shared/relation-kind"
import {
	buildRelationRings,
	getWayMembersByRole,
} from "@osmix/shared/relation-multipolygon"
import type {
	LonLat,
	OsmEntity,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "@osmix/shared/types"
import { isNode, isRelation, isWay } from "@osmix/shared/utils"
import { wayIsArea } from "@osmix/shared/way-is-area"
import type {
	GeometryCollection,
	LineString,
	MultiLineString,
	MultiPoint,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"
import type { OsmGeoJSONFeature } from "./types"

/**
 * Convert an OsmNode to a GeoJSON Point feature.
 */
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

/**
 * Convert an OsmWay to a GeoJSON LineString or Polygon feature. Determines the geometry type based on
 * the `wayIsArea` function.
 */
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

/**
 * Convert an OsmRelation to a GeoJSON feature. Determines the geometry type based on
 * the `getRelationKind` function.
 */
export function relationToFeature(
	relation: OsmRelation,
	refToPosition: (id: number) => [number, number],
	getWay?: (wayId: number) => OsmWay | null,
): OsmGeoJSONFeature<
	| Polygon
	| MultiPolygon
	| LineString
	| MultiLineString
	| Point
	| MultiPoint
	| GeometryCollection
> {
	const getNodeCoordinates = (nodeId: number): LonLat | undefined => {
		const pos = refToPosition(nodeId)
		return pos ? [pos[0], pos[1]] : undefined
	}

	const kind = getRelationKind(relation)

	// Handle area relations (multipolygon, boundary)
	if (isAreaRelation(relation) && getWay) {
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

	// Handle line relations (route, multilinestring)
	if (kind === "line" && getWay) {
		const lineStrings = buildRelationLineStrings(
			relation,
			getWay,
			getNodeCoordinates,
		)

		if (lineStrings.length === 0) {
			return {
				type: "Feature",
				id: relation.id,
				geometry: {
					type: "MultiLineString",
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

		if (lineStrings.length === 1) {
			return {
				type: "Feature",
				id: relation.id,
				geometry: {
					type: "LineString",
					coordinates: lineStrings[0]!,
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
				type: "MultiLineString",
				coordinates: lineStrings,
			},
			properties: {
				id: relation.id,
				type: "relation",
				...relation.info,
				...relation.tags,
			},
		}
	}

	// Handle point relations (multipoint)
	if (kind === "point") {
		const points = collectRelationPoints(relation, getNodeCoordinates)

		if (points.length === 0) {
			return {
				type: "Feature",
				id: relation.id,
				geometry: {
					type: "MultiPoint",
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

		if (points.length === 1) {
			return {
				type: "Feature",
				id: relation.id,
				geometry: {
					type: "Point",
					coordinates: points[0]!,
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
				type: "MultiPoint",
				coordinates: points,
			},
			properties: {
				id: relation.id,
				type: "relation",
				...relation.info,
				...relation.tags,
			},
		}
	}

	// Fallback for logical relations or when getWay is not provided
	// Return GeometryCollection or null geometry for logic-only relations
	if (kind === "logic" || kind === "super") {
		return {
			type: "Feature",
			id: relation.id,
			geometry: {
				type: "GeometryCollection",
				geometries: [],
			},
			properties: {
				id: relation.id,
				type: "relation",
				...relation.info,
				...relation.tags,
			},
		}
	}

	// Final fallback: try to create a simple representation from way members
	if (getWay) {
		const { outer } = getWayMembersByRole(relation)
		const coordinates: [number, number][][][] = []

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

	// No geometry available
	return {
		type: "Feature",
		id: relation.id,
		geometry: {
			type: "GeometryCollection",
			geometries: [],
		},
		properties: {
			id: relation.id,
			type: "relation",
			...relation.info,
			...relation.tags,
		},
	}
}

/**
 * Helper to convert an Osm entity to a GeoJSON feature.
 */
export function osmEntityToGeoJSONFeature(
	osm: Osm,
	entity: OsmEntity,
): OsmGeoJSONFeature<
	| GeoJSON.Point
	| GeoJSON.LineString
	| GeoJSON.Polygon
	| GeoJSON.MultiPolygon
	| GeoJSON.MultiLineString
	| GeoJSON.MultiPoint
	| GeoJSON.GeometryCollection
> {
	if (isNode(entity)) {
		return nodeToFeature(entity)
	}
	if (isWay(entity)) {
		return wayToFeature(entity, (ref) => osm.nodes.getNodeLonLat({ id: ref }))
	}
	if (isRelation(entity)) {
		return relationToFeature(
			entity,
			(ref) => osm.nodes.getNodeLonLat({ id: ref }),
			(ref) => osm.ways.getById(ref),
		)
	}
	throw new Error("Unknown entity type")
}
