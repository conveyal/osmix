/**
 * Calculate the haversine distance between two LonLat points.
 * @param p1 - The first point
 * @param p2 - The second point
 * @returns The haversine distance in meters
 */
export function haversineDistance(
	p1: [number, number],
	p2: [number, number],
): number {
	const R = 6371008.8 // Earth's radius in meters
	const dLat = (p2[1] - p1[1]) * (Math.PI / 180)
	const dLon = (p2[0] - p1[0]) * (Math.PI / 180)
	const lat1 = p1[1] * (Math.PI / 180)
	const lat2 = p2[1] * (Math.PI / 180)
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
	return R * c
}
