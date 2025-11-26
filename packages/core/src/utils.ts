/**
 * Utility functions for @osmix/core.
 * @module
 */

import type { GeoBbox2D, LonLat } from "@osmix/shared/types"

/**
 * Compute the bounding box of a set of coordinates.
 * Returns `[minLon, minLat, maxLon, maxLat]`.
 */
export function bboxFromLonLats(lonLats: LonLat[]): GeoBbox2D {
	let minLon = Number.POSITIVE_INFINITY
	let minLat = Number.POSITIVE_INFINITY
	let maxLon = Number.NEGATIVE_INFINITY
	let maxLat = Number.NEGATIVE_INFINITY
	for (const [lon, lat] of lonLats) {
		if (lon < minLon) minLon = lon
		if (lat < minLat) minLat = lat
		if (lon > maxLon) maxLon = lon
		if (lat > maxLat) maxLat = lat
	}
	return [minLon, minLat, maxLon, maxLat]
}
