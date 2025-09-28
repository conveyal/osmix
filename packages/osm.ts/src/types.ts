import type { OsmPbfInfo } from "@osmix/pbf"

export type OsmEntityType = "node" | "way" | "relation"

export interface OsmEntityTypeMap extends Record<OsmEntityType, IOsmEntity> {
	node: OsmNode
	way: OsmWay
	relation: OsmRelation
}

export interface LonLat {
	lon: number
	lat: number
}

export type TileIndex = {
	z: number
	x: number
	y: number
}

export const RelationMemberType = {
	NODE: 0,
	WAY: 1,
	RELATION: 2,
} as const

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

export interface OsmInfoParsed extends OsmPbfInfo {
	user?: string
}

export interface OsmTags {
	[key: string]: string | number
}

interface IOsmEntity {
	id: number
	info?: OsmInfoParsed
	tags?: OsmTags
}

export interface OsmNode extends IOsmEntity, LonLat {}

export interface OsmWay extends IOsmEntity {
	// OSM IDs of the nodes that make up this way
	refs: number[]
}

export interface OsmRelationMember {
	type: OsmEntityType
	ref: number
	role?: string
}

export interface OsmRelation extends IOsmEntity {
	members: OsmRelationMember[]
}

export type OsmEntity = OsmNode | OsmWay | OsmRelation

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

export type OsmChange<T extends IOsmEntity = OsmEntity> = {
	changeType: "modify" | "create" | "delete"
	entity: T
	osmId: string // When merging datasets, we need to keep track of the entity's origin dataset.

	// Used to lookup related entities, refs, and relations
	refs?: OsmEntityRef[]
}
