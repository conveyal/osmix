/**
 * Type definitions for vector tile encoding.
 *
 * These types represent the intermediate format used when converting
 * OSM entities to Mapbox Vector Tile features.
 *
 * @module
 */

import type { OsmTags, XY } from "@osmix/shared/types"

/**
 * Geometry for a vector tile feature.
 * Array of rings/segments, where each ring/segment is an array of [x, y] coordinates.
 */
export type VtSimpleFeatureGeometry = XY[][]

/**
 * Properties attached to a vector tile feature.
 * Includes OSM tags plus optional source metadata.
 */
export type VtSimpleFeatureProperties = {
	sourceId?: string
	tileKey?: string
} & OsmTags

/**
 * MVT geometry type constants.
 * Point = 1, Line = 2, Polygon = 3.
 */
export type VtSimpleFeatureType = {
	POINT: 1
	LINE: 2
	POLYGON: 3
}

/**
 * A simplified vector tile feature ready for encoding.
 * Geometry coordinates are in tile extent units (typically 0-4096).
 */
export interface VtSimpleFeature {
	id: number
	type: VtSimpleFeatureType[keyof VtSimpleFeatureType]
	properties: VtSimpleFeatureProperties
	geometry: VtSimpleFeatureGeometry
}

/**
 * A layer to be written to the vector tile PBF.
 * Features are provided via a generator to support lazy evaluation.
 */
export type VtPbfLayer = {
	name: string
	version: number
	extent: number
	features: Generator<VtSimpleFeature>
}
