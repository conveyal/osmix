import type { OsmPbfInfo } from "@osmix/pbf"
import type { ILonLat } from "@osmix/shared/types"
import type { Feature, LineString, MultiPolygon, Point, Polygon } from "geojson"

export type OsmEntityType = "node" | "way" | "relation"

export interface OsmEntityTypeMap extends Record<OsmEntityType, IOsmEntity> {
	node: OsmNode
	way: OsmWay
	relation: OsmRelation
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

export type OsmixGeoJsonProperties = {
	id: number
	type: OsmEntityType
	tags?: OsmTags
	info?: OsmInfoParsed
}

export type OsmixGeoJSONFeature<
	T extends Point | LineString | Polygon | MultiPolygon,
> = Feature<T, OsmixGeoJsonProperties>
