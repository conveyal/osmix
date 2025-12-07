/**
 * OSM entity to GeoJSON Feature conversion.
 *
 * Converts OSM nodes, ways, and relations into GeoJSON Features with
 * appropriate geometry types and preserved properties.
 *
 * @module
 */

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
 * Convert an OSM node to a GeoJSON Point feature.
 *
 * @param node - OSM node with id, lon, lat, and optional tags.
 * @returns GeoJSON Point Feature with OSM properties.
 *
 * @example
 * ```ts
 * const feature = nodeToFeature({ id: 1, lon: -122.4, lat: 47.6, tags: { name: "Seattle" } })
 * // { type: "Feature", geometry: { type: "Point", coordinates: [-122.4, 47.6] }, ... }
 * ```
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
 * Convert an OSM way to a GeoJSON LineString or Polygon feature.
 *
 * Geometry type is determined by the `wayIsArea` helper, which checks for
 * area-indicating tags (building, landuse, etc.) and ring closure.
 *
 * @param way - OSM way with id, refs, and optional tags.
 * @param refToPosition - Function to resolve node ID to [lon, lat] coordinates.
 * @returns GeoJSON LineString or Polygon Feature with OSM properties.
 *
 * @example
 * ```ts
 * const feature = wayToFeature(way, (ref) => osm.nodes.getNodeLonLat({ id: ref }))
 * ```
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
 * Convert an OSM relation to a GeoJSON feature.
 *
 * Geometry type is determined by relation type and tags:
 * - **Multipolygon/boundary**: MultiPolygon or Polygon
 * - **Route/multilinestring**: MultiLineString or LineString
 * - **Site/collection**: MultiPoint or Point
 * - **Other**: GeometryCollection (empty for logical relations)
 *
 * @param relation - OSM relation with id, members, and optional tags.
 * @param refToPosition - Function to resolve node ID to [lon, lat] coordinates.
 * @param getWay - Optional function to resolve way ID to OsmWay (required for polygons/lines).
 * @returns GeoJSON Feature with appropriate geometry type.
 *
 * @example
 * ```ts
 * const feature = relationToFeature(
 *   relation,
 *   (ref) => osm.nodes.getNodeLonLat({ id: ref }),
 *   (ref) => osm.ways.getById(ref)
 * )
 * ```
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
 * Convert any OSM entity to a GeoJSON feature using an Osm index.
 *
 * Convenience function that handles entity type detection and coordinate
 * resolution automatically using the provided Osm index.
 *
 * @param osm - Osm index for coordinate lookups.
 * @param entity - Any OSM entity (node, way, or relation).
 * @returns GeoJSON Feature with appropriate geometry.
 * @throws If entity type is unknown.
 *
 * @example
 * ```ts
 * for (const way of osm.ways) {
 *   const feature = osmEntityToGeoJSONFeature(osm, way)
 *   features.push(feature)
 * }
 * ```
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
