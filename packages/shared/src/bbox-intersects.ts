import type { GeoBbox2D } from "./types"

/**
 * Check if the two bboxes intersect or are contained within each other.
 * Handles both partial overlaps and complete containment.
 */
export function bboxContainsOrIntersects(bb1: GeoBbox2D, bb2: GeoBbox2D) {
	const westIn =
		(bb1[0] >= bb2[0] && bb1[0] <= bb2[2]) ||
		(bb2[0] >= bb1[0] && bb2[0] <= bb1[2])
	const eastIn =
		(bb1[2] >= bb2[0] && bb1[2] <= bb2[2]) ||
		(bb2[2] >= bb1[0] && bb2[2] <= bb1[2])
	const northIn =
		(bb1[1] >= bb2[1] && bb1[1] <= bb2[3]) ||
		(bb2[1] >= bb1[1] && bb2[1] <= bb1[3])
	const southIn =
		(bb1[3] >= bb2[1] && bb1[3] <= bb2[3]) ||
		(bb2[3] >= bb1[1] && bb2[3] <= bb1[3])
	return (westIn || eastIn) && (northIn || southIn)
}
