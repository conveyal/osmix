/**
 * Shortbread Vector Tile Schema
 *
 * This module provides a Shortbread-compliant vector tile encoder.
 * Based on https://shortbread-tiles.org/schema/1.0/
 *
 * @example
 * ```typescript
 * import { ShortbreadVtEncoder } from "@osmix/shortbread"
 *
 * const encoder = new ShortbreadVtEncoder(osm)
 * const tile = encoder.getTile([z, x, y])
 * ```
 */

export { ShortbreadVtEncoder } from "./encoder"
export {
	getLayersForGeometryType,
	matchTags,
	SHORTBREAD_LAYERS,
} from "./layers"
export type {
	AddressProperties,
	AerialwayKind,
	AerialwayProperties,
	BoundaryKind,
	BoundaryProperties,
	BridgeProperties,
	BuildingProperties,
	DamProperties,
	FerryProperties,
	LandKind,
	LandProperties,
	LayerMatcher,
	PierProperties,
	PlaceKind,
	PlaceProperties,
	PoiKind,
	PoiProperties,
	PublicTransportKind,
	PublicTransportProperties,
	ShortbreadBaseProperties,
	ShortbreadFeature,
	ShortbreadGeometryType,
	ShortbreadLayerDefinition,
	ShortbreadLayerName,
	ShortbreadProperties,
	SiteKind,
	SiteProperties,
	StreetKind,
	StreetProperties,
	WaterKind,
	WaterLineKind,
	WaterLineProperties,
	WaterProperties,
} from "./types"
