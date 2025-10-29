import type { GeoBbox2D } from "@osmix/shared/types"

export function calculateTestGeometriesFromBbox(bbox: GeoBbox2D) {
	// Calculate center and bboxes from the data
	const centerLon = (bbox[0] + bbox[2]) / 2
	const centerLat = (bbox[1] + bbox[3]) / 2

	const lonExtent = bbox[2] - bbox[0]
	const latExtent = bbox[3] - bbox[1]

	const smallSize = Math.min(lonExtent, latExtent) * 0.01
	const mediumSize = Math.min(lonExtent, latExtent) * 0.1
	const largeSize = Math.min(lonExtent, latExtent) * 0.5

	const bboxes = {
		small: [
			centerLon - smallSize / 2,
			centerLat - smallSize / 2,
			centerLon + smallSize / 2,
			centerLat + smallSize / 2,
		] as GeoBbox2D,
		medium: [
			centerLon - mediumSize / 2,
			centerLat - mediumSize / 2,
			centerLon + mediumSize / 2,
			centerLat + mediumSize / 2,
		] as GeoBbox2D,
		large: [
			centerLon - largeSize / 2,
			centerLat - largeSize / 2,
			centerLon + largeSize / 2,
			centerLat + largeSize / 2,
		] as GeoBbox2D,
	}

	return {
		centerLon,
		centerLat,
		bboxes,
	}
}
