import type { OsmEntity, OsmEntityType, OsmTags } from "@osmix/json"

/**
 * A bounding box in the format [minLon, minLat, maxLon, maxLat].
 * GeoJSON.BBox allows for 3D bounding boxes, but we use tools that expect 2D bounding boxes.
 */
export type GeoBbox2D = [
	minLon: number,
	minLat: number,
	maxLon: number,
	maxLat: number,
]

export type Rgba = [number, number, number, number] | Uint8ClampedArray

export interface TileIndex {
	z: number
	x: number
	y: number
}

export interface OsmGeoJSONProperties extends OsmTags {}

export type OsmGeoJSONFeature = GeoJSON.Feature<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
	OsmGeoJSONProperties
>

// String that starts with `n`, `w`, or `r` followed by the ID
export type OsmEntityRef = {
	type: OsmEntityType
	id: number
	osmId: string
}

export type OsmChange<T extends OsmEntity = OsmEntity> = {
	changeType: "modify" | "create" | "delete"
	entity: T
	osmId: string // When merging datasets, we need to keep track of the entity's origin dataset.

	// Used to lookup related entities, refs, and relations
	refs?: OsmEntityRef[]
}
