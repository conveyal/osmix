import type { OsmEntityType, OsmInfoParsed, OsmTags } from "@osmix/shared/types"
import type {
	Feature,
	GeometryCollection,
	LineString,
	MultiLineString,
	MultiPoint,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"

export type OsmGeoJSONProperties = {
	id: number
	type: OsmEntityType
	tags?: OsmTags
	info?: OsmInfoParsed
}

export type OsmGeoJSONFeature<
	T extends
		| Point
		| LineString
		| Polygon
		| MultiPolygon
		| MultiLineString
		| MultiPoint
		| GeometryCollection,
> = Feature<T, OsmGeoJSONProperties>

export type ImportableGeoJSON = GeoJSON.FeatureCollection<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.MultiPolygon
>

export type ReadOsmDataTypes =
	| ArrayBufferLike
	| ReadableStream
	| string
	| ImportableGeoJSON
