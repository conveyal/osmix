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
export type * from "./types"
