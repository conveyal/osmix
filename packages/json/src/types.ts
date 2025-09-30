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

export interface OsmInfoParsed extends OsmPbfInfo {
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
