import type { OsmPbfInfo } from "./pbf/proto/osmformat"

export type OsmEntityType = "node" | "way" | "relation"

export interface LonLat {
	lon: number
	lat: number
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
export type Bbox = [
	minLon: number,
	minLat: number,
	maxLon: number,
	maxLat: number,
]

export interface OsmInfoParsed extends OsmPbfInfo {
	user?: string
}

export interface OsmTags {
	[key: string]: string | number
}

export interface OsmEntity {
	id: number
	tags?: OsmTags
	info?: OsmInfoParsed
}

export interface OsmNode extends OsmEntity, LonLat {}

export interface OsmWay extends OsmEntity {
	refs: number[]
}

export interface OsmRelationMember {
	type: string
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
