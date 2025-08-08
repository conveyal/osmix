import type { OsmPbfInfo } from "./pbf/proto/osmformat"

export type OsmEntityType = "node" | "way" | "relation"

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

export interface OsmEntity {
	id: number
	info?: OsmInfoParsed
	tags?: OsmTags
}

export interface OsmNode extends OsmEntity, LonLat {}

export interface OsmWay extends OsmEntity {
	// OSM IDs of the nodes that make up this way
	refs: number[]
}

export interface OsmRelationMember {
	type: "node" | "way" | "relation"
	ref: number
	role?: string
}

export interface OsmRelation extends OsmEntity {
	members: OsmRelationMember[]
}

export interface OsmGeoJSONProperties extends OsmTags {}

export type OsmGeoJSONFeature = GeoJSON.Feature<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
	OsmGeoJSONProperties
>

export type OsmChange = {
	changeType: "modify" | "create" | "delete"
	entity: OsmNode | OsmWay | OsmRelation
}
