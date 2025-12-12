/**
 * WKB (Well-Known Binary) geometry parsing utilities.
 *
 * Uses well-known-parser for parsing WKB-encoded geometries from GeoParquet files.
 *
 * @module
 */

import type { Geometry } from "geojson"
import { parse } from "well-known-parser"

/**
 * Parse a WKB geometry into a GeoJSON Geometry object.
 *
 * Supports Point, LineString, Polygon, MultiPoint, MultiLineString,
 * MultiPolygon, and GeometryCollection. Also handles EWKB with SRID.
 *
 * @param wkb - WKB-encoded geometry as Uint8Array
 * @returns Parsed GeoJSON Geometry
 */
export function parseWkb(wkb: Uint8Array): Geometry {
	// Convert Uint8Array to Buffer for well-known-parser
	const buffer = Buffer.from(wkb.buffer, wkb.byteOffset, wkb.byteLength)
	const geometry = parse(buffer)
	return geometry.toGeoJSON() as Geometry
}
