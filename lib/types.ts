import type { OsmPbfInfo } from "./proto/osmformat"

export * from "./proto/fileformat"
export * from "./proto/osmformat"

export interface OsmPbfInfoParsed extends OsmPbfInfo {
	user?: string
}

export interface OsmTags {
	[key: string]: string | number | boolean
}

export interface OsmEntity {
	id: number
	tags?: OsmTags
	info?: OsmPbfInfoParsed
}

export interface OsmNode extends OsmEntity {
	lat: number
	lon: number
}

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
