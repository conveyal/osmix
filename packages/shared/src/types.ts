export type LonLat = [lon: number, lat: number]
export type XY = [x: number, y: number]
export interface ILonLat {
	lon: number
	lat: number
}
export type Tile = [x: number, y: number, z: number]

/**
 * Project LonLat to pixels
 */
export type LonLatToPixel = (ll: LonLat, zoom: number) => XY

export type LonLatToTilePixel = (ll: LonLat, z: number, extent: number) => XY

export type Rgba =
	| [r: number, g: number, b: number, a: number]
	| Uint8ClampedArray

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

/**
 * Shared OSM Types
 */

export type OsmEntityType = "node" | "way" | "relation"

export interface OsmEntityTypeMap extends Record<OsmEntityType, IOsmEntity> {
	node: OsmNode
	way: OsmWay
	relation: OsmRelation
}

export interface OsmInfoParsed {
	version?: number
	timestamp?: number
	changeset?: number
	uid?: number
	user_sid?: number
	visible?: boolean
	user?: string
}

export interface OsmTags {
	[key: string]: string | number
}

export interface IOsmEntity {
	id: number
	info?: OsmInfoParsed
	tags?: OsmTags
}

export interface OsmNode extends IOsmEntity, ILonLat {}

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
