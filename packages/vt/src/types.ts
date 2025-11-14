import type { OsmEntityType, OsmTags, XY } from "@osmix/shared/types"

export type VtSimpleFeatureGeometry = XY[][]

export type VtSimpleFeatureProperties = {
	sourceId?: string
	type: OsmEntityType
	tileKey?: string
} & OsmTags

export type VtSimpleFeatureType = {
	POINT: 1
	LINE: 2
	POLYGON: 3
}

export interface VtSimpleFeature {
	id: number
	type: VtSimpleFeatureType[keyof VtSimpleFeatureType]
	properties: VtSimpleFeatureProperties
	geometry: VtSimpleFeatureGeometry
}

export type VtPbfLayer = {
	name: string
	version: number
	extent: number
	features: Generator<VtSimpleFeature>
}
