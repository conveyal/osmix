export type OsmPbfBlob = {
	raw_size?: number
	raw?: Uint8Array
	zlib_data?: Uint8Array
}

export type OsmPbfBlobHeader = {
	type: "OSMHeader" | "OSMData"
	datasize: number
}

export type OsmPbfHeaderBBox = {
	left: number
	right: number
	top: number
	bottom: number
}

export type OsmPbfHeaderBlock = {
	bbox?: OsmPbfHeaderBBox
	required_features: string[]
	optional_features: string[]
	writingprogram?: string
	source?: string
	osmosis_replication_timestamp?: number
	osmosis_replication_sequence_number?: number
	osmosis_replication_base_url?: string
}

export type OsmPbfPrimitiveBlock = {
	stringtable: string[]
	primitivegroup: OsmPbfPrimitiveGroup[]
	granularity?: number
	lat_offset?: number
	lon_offset?: number
	date_granularity?: number
}

export type OsmPbfPrimitiveGroup = {
	nodes: OsmPbfNode[]
	dense?: OsmPbfDenseNodes
	ways: OsmPbfWay[]
	relations: OsmPbfRelation[]
}

export type OsmPbfStringTable = {
	s: Uint8Array[]
}

export interface OsmPbfInfo {
	version?: number
	timestamp?: number
	changeset?: number
	uid?: number
	user_sid?: number
	visible?: boolean
}

export type OsmPbfDenseInfo = {
	version: number[]
	timestamp: number[]
	changeset: number[]
	uid: number[]
	user_sid: number[]
	visible: boolean[]
}

export interface OsmPbfPrimitive {
	id: number
	keys: number[]
	vals: number[]
	info?: OsmPbfInfo
}

export interface OsmPbfNode extends OsmPbfPrimitive {
	lat: number
	lon: number
}

export type OsmPbfDenseNodes = {
	id: number[]
	denseinfo?: OsmPbfDenseInfo
	lat: number[]
	lon: number[]
	keys_vals: number[]
}

export interface OsmPbfWay extends OsmPbfPrimitive {
	refs: number[]
}

export interface OsmPbfRelation extends OsmPbfPrimitive {
	roles_sid: number[]
	memids: number[]
	types: number[]
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

export interface OsmPbfInfoParsed extends OsmPbfInfo {
	user?: string
}

export interface OsmTags {
	[key: string]: string | number
}

export interface OsmEntity {
	id: number
	type: "node" | "way" | "relation"
	tags?: OsmTags
	info?: OsmPbfInfoParsed
}

export interface OsmNode extends OsmEntity {
	type: "node"
	lat: number
	lon: number
}

export interface OsmWay extends OsmEntity {
	type: "way"
	refs: number[]
}

export interface OsmRelationMember {
	type: string
	ref: number
	role?: string
}

export interface OsmRelation extends OsmEntity {
	type: "relation"
	members: OsmRelationMember[]
}

export interface OsmGeoJSONProperties extends OsmTags {}

export type OsmGeoJSONFeature = GeoJSON.Feature<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
	OsmGeoJSONProperties
>
