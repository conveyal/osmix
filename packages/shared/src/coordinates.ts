import type { GeoBbox2D } from "./types"

/**
 * OSM coordinate scale: coordinates are stored as integer microdegrees.
 * 1 microdegree = 1e-7 degrees = 0.0000001 degrees
 */
export const OSM_COORD_SCALE = 1e7

/**
 * Convert degrees to microdegrees (integer).
 */
export function toMicroDegrees(degrees: number): number {
	return Math.round(degrees * OSM_COORD_SCALE)
}

/**
 * Convert microdegrees (integer) to degrees (float).
 */
export function microToDegrees(microdegrees: number): number {
	return microdegrees / OSM_COORD_SCALE
}

/**
 * Convert a bounding box from degrees to microdegrees.
 */
export function bboxToMicroDegrees(
	bbox: GeoBbox2D,
): [minLon: number, minLat: number, maxLon: number, maxLat: number] {
	return [
		toMicroDegrees(bbox[0]),
		toMicroDegrees(bbox[1]),
		toMicroDegrees(bbox[2]),
		toMicroDegrees(bbox[3]),
	]
}
