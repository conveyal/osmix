import type { GeoBbox2D, LonLat } from "@osmix/json"

export function throttle<T extends unknown[]>(
	func: (...args: T) => void,
	timeFrame: number,
) {
	let lastTime = 0
	return (...args: T) => {
		const now = Date.now()
		if (now - lastTime >= timeFrame) {
			func(...args)
			lastTime = now
		}
	}
}

export function bboxFromLonLats(lonLats: LonLat[]): GeoBbox2D {
	let minLon = Number.POSITIVE_INFINITY
	let minLat = Number.POSITIVE_INFINITY
	let maxLon = Number.NEGATIVE_INFINITY
	let maxLat = Number.NEGATIVE_INFINITY
	for (const lonLat of lonLats) {
		if (lonLat.lon < minLon) minLon = lonLat.lon
		if (lonLat.lat < minLat) minLat = lonLat.lat
		if (lonLat.lon > maxLon) maxLon = lonLat.lon
		if (lonLat.lat > maxLat) maxLat = lonLat.lat
	}
	return [minLon, minLat, maxLon, maxLat]
}
