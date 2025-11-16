import type { OsmEntityType, OsmInfoParsed, OsmTags } from "@osmix/shared/types"
import type { Feature, LineString, MultiPolygon, Point, Polygon } from "geojson"

export type OsmGeoJSONProperties = {
	id: number
	type: OsmEntityType
	tags?: OsmTags
	info?: OsmInfoParsed
}

export type OsmGeoJSONFeature<
	T extends Point | LineString | Polygon | MultiPolygon,
> = Feature<T, OsmGeoJSONProperties>
