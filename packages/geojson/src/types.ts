/**
 * Type definitions for OSM-GeoJSON conversion.
 * @module
 */

import type { OsmEntityType, OsmInfoParsed, OsmTags } from "@osmix/shared/types"
import type {
	Feature,
	GeometryCollection,
	LineString,
	MultiLineString,
	MultiPoint,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"

/**
 * GeoJSON Feature properties for OSM entities.
 *
 * Includes the OSM entity ID, type, and optionally tags and metadata.
 * All OSM tags are spread into the properties object.
 */
export type OsmGeoJSONProperties = {
	/** OSM entity ID. */
	id: number
	/** Entity type: "node", "way", or "relation". */
	type: OsmEntityType
	/** OSM tags (key-value pairs). */
	tags?: OsmTags
	/** Entity metadata (version, timestamp, user, etc.). */
	info?: OsmInfoParsed
}

/**
 * GeoJSON Feature with OSM-specific properties.
 *
 * Generic over geometry type to support all OSM entity conversions:
 * - Nodes → Point
 * - Ways → LineString or Polygon
 * - Relations → MultiPolygon, MultiLineString, MultiPoint, or GeometryCollection
 */
export type OsmGeoJSONFeature<
	T extends
		| Point
		| LineString
		| Polygon
		| MultiPolygon
		| MultiLineString
		| MultiPoint
		| GeometryCollection,
> = Feature<T, OsmGeoJSONProperties>

/**
 * GeoJSON FeatureCollection types that can be imported into an Osm index.
 *
 * Supports Point, LineString, Polygon, and MultiPolygon geometries.
 * Other geometry types are not supported for import.
 */
export type ImportableGeoJSON = GeoJSON.FeatureCollection<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.MultiPolygon
>

/**
 * Input types accepted by `fromGeoJSON`.
 *
 * Supports multiple formats:
 * - `ArrayBufferLike` - Binary GeoJSON data
 * - `ReadableStream` - Streaming GeoJSON
 * - `string` - JSON string
 * - `ImportableGeoJSON` - Already-parsed FeatureCollection
 */
export type ReadOsmDataTypes =
	| ArrayBufferLike
	| ReadableStream
	| string
	| ImportableGeoJSON
