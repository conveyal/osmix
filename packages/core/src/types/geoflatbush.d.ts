declare module "geoflatbush" {
	import type Flatbush from "flatbush"

	/**
	 * Returns an array of the closest items from a given location in order of increasing distance.
	 * @param index - A Flatbush index with geographic bounding boxes in degrees (minLng, minLat, maxLng, maxLat).
	 * @param lng - Query point longitude in degrees.
	 * @param lat - Query point latitude in degrees.
	 * @param maxResults - Maximum number of items to return (default: Infinity).
	 * @param maxDistance - Maximum distance in kilometers (default: Infinity).
	 * @param filterFn - Optional filter function called with index of each item.
	 * @returns Array of item indices from the index, sorted by distance.
	 */
	export function around(
		index: Flatbush,
		lng: number,
		lat: number,
		maxResults?: number,
		maxDistance?: number,
		filterFn?: (index: number) => boolean,
	): number[]

	/**
	 * Returns the great circle distance between two locations in kilometers.
	 * @param lng1 - First point longitude in degrees.
	 * @param lat1 - First point latitude in degrees.
	 * @param lng2 - Second point longitude in degrees.
	 * @param lat2 - Second point latitude in degrees.
	 * @returns Distance in kilometers.
	 */
	export function distance(
		lng: number,
		lat: number,
		lng2: number,
		lat2: number,
	): number
}
