declare module "geokdbush" {
	import type KDBush from "kdbush"

	/**
	 * Returns an array of the closest points from a given location in order of increasing distance.
	 * @param index - A KDBush index with geographic coordinates (lng, lat) in degrees.
	 * @param lng - Query point longitude in degrees.
	 * @param lat - Query point latitude in degrees.
	 * @param maxResults - Maximum number of points to return (default: Infinity).
	 * @param maxDistance - Maximum distance in kilometers (default: Infinity).
	 * @param predicate - Optional filter function called with index of each point.
	 * @returns Array of point indices from the index, sorted by distance.
	 */
	export function around(
		index: KDBush,
		lng: number,
		lat: number,
		maxResults?: number,
		maxDistance?: number,
		predicate?: (index: number) => boolean,
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
		lng1: number,
		lat1: number,
		lng2: number,
		lat2: number,
	): number
}
