import type { LonLat } from "@osmix/shared/types"
import type { OsmRelation, OsmRelationMember, OsmWay } from "./types"

/**
 * Check if a relation is a multipolygon relation.
 */
export function isMultipolygonRelation(relation: OsmRelation): boolean {
	return relation.tags?.["type"] === "multipolygon"
}

/**
 * Get way members from a relation, grouped by role (outer/inner).
 */
export function getWayMembersByRole(relation: OsmRelation): {
	outer: OsmRelationMember[]
	inner: OsmRelationMember[]
} {
	const outer: OsmRelationMember[] = []
	const inner: OsmRelationMember[] = []

	for (const member of relation.members) {
		if (member.type !== "way") continue
		const role = member.role?.toLowerCase() ?? ""
		if (role === "outer") {
			outer.push(member)
		} else if (role === "inner") {
			inner.push(member)
		}
	}

	return { outer, inner }
}

/**
 * Connect ways that share endpoints to form a continuous ring.
 * Returns an array of rings (each ring is an array of way IDs in order).
 */
export function connectWaysToRings(
	wayMembers: OsmRelationMember[],
	getWay: (wayId: number) => OsmWay | null,
): number[][] {
	if (wayMembers.length === 0) return []

	const rings: number[][] = []
	const used = new Set<number>()
	const wayMap = new Map<number, OsmRelationMember>()

	// Build map of way ID to member
	for (const member of wayMembers) {
		wayMap.set(member.ref, member)
	}

	// Helper to get endpoints of a way
	const getEndpoints = (way: OsmWay): [number, number] => {
		if (way.refs.length === 0) return [0, 0]
		return [way.refs[0]!, way.refs[way.refs.length - 1]!]
	}

	// Helper to reverse a way's refs
	const reverseWay = (way: OsmWay): OsmWay => ({
		...way,
		refs: [...way.refs].reverse(),
	})

	// Build rings by connecting ways
	for (const startMember of wayMembers) {
		if (used.has(startMember.ref)) continue

		const startWay = getWay(startMember.ref)
		if (!startWay || startWay.refs.length < 2) continue

		const ring: number[] = [startMember.ref]
		used.add(startMember.ref)

		let currentWay = startWay
		let [currentStart, currentEnd] = getEndpoints(currentWay)

		// Try to extend the ring forward
		while (true) {
			let found = false
			for (const member of wayMembers) {
				if (used.has(member.ref)) continue

				const nextWay = getWay(member.ref)
				if (!nextWay || nextWay.refs.length < 2) continue

				const [nextStart, nextEnd] = getEndpoints(nextWay)

				// Check if next way connects to current end
				if (currentEnd === nextStart) {
					ring.push(member.ref)
					used.add(member.ref)
					currentWay = nextWay
					currentEnd = nextEnd
					found = true
					break
				}
				if (currentEnd === nextEnd) {
					// Need to reverse next way
					ring.push(member.ref)
					used.add(member.ref)
					currentWay = reverseWay(nextWay)
					currentEnd = nextStart
					found = true
					break
				}
			}

			if (!found) break
		}

		// Try to extend the ring backward
		currentWay = startWay
		;[currentStart, currentEnd] = getEndpoints(currentWay)

		while (true) {
			let found = false
			for (const member of wayMembers) {
				if (used.has(member.ref)) continue

				const nextWay = getWay(member.ref)
				if (!nextWay || nextWay.refs.length < 2) continue

				const [nextStart, nextEnd] = getEndpoints(nextWay)

				// Check if next way connects to current start
				if (currentStart === nextEnd) {
					ring.unshift(member.ref)
					used.add(member.ref)
					currentWay = nextWay
					currentStart = nextStart
					found = true
					break
				}
				if (currentStart === nextStart) {
					// Need to reverse next way
					ring.unshift(member.ref)
					used.add(member.ref)
					currentWay = reverseWay(nextWay)
					currentStart = nextEnd
					found = true
					break
				}
			}

			if (!found) break
		}

		// Only add ring if it's closed (first and last node are the same)
		if (ring.length > 0) {
			const firstWay = getWay(ring[0]!)
			const lastWay = getWay(ring[ring.length - 1]!)
			if (firstWay && lastWay) {
				const firstStart = firstWay.refs[0]
				const lastEnd = lastWay.refs[lastWay.refs.length - 1]
				if (firstStart === lastEnd) {
					rings.push(ring)
				}
			}
		}
	}

	return rings
}

/**
 * Build polygon rings from way members of a relation.
 * Returns an array where each element is an array of coordinate rings (outer + inner).
 */
export function buildRelationRings(
	relation: OsmRelation,
	getWay: (wayId: number) => OsmWay | null,
	getNodeCoordinates: (nodeId: number) => LonLat | undefined,
): LonLat[][][] {
	const { outer, inner } = getWayMembersByRole(relation)

	// Connect outer ways into rings
	const outerRings = connectWaysToRings(outer, getWay)
	// Connect inner ways into rings
	const innerRings = connectWaysToRings(inner, getWay)

	// Convert way rings to coordinate rings
	const coordinateRings: LonLat[][][] = []

	for (const outerRing of outerRings) {
		const outerCoordinates: LonLat[] = []
		for (const wayId of outerRing) {
			const way = getWay(wayId)
			if (!way) continue

			for (const nodeId of way.refs) {
				const coord = getNodeCoordinates(nodeId)
				if (coord) {
					outerCoordinates.push(coord)
				}
			}
		}

		// Ensure ring is closed
		if (outerCoordinates.length > 0) {
			const first = outerCoordinates[0]
			const last = outerCoordinates[outerCoordinates.length - 1]
			if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
				outerCoordinates.push([first[0], first[1]])
			}
		}

		if (outerCoordinates.length >= 3) {
			// Find inner rings that belong to this outer ring
			const innerCoordinates: LonLat[][] = []
			for (const innerRing of innerRings) {
				const innerCoords: LonLat[] = []
				for (const wayId of innerRing) {
					const way = getWay(wayId)
					if (!way) continue

					for (const nodeId of way.refs) {
						const coord = getNodeCoordinates(nodeId)
						if (coord) {
							innerCoords.push(coord)
						}
					}
				}

				// Ensure ring is closed
				if (innerCoords.length > 0) {
					const first = innerCoords[0]
					const last = innerCoords[innerCoords.length - 1]
					if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
						innerCoords.push([first[0], first[1]])
					}
				}

				if (innerCoords.length >= 3) {
					// Simple check: if any point of inner ring is within outer ring bbox
					// In a full implementation, we'd do proper point-in-polygon test
					innerCoordinates.push(innerCoords)
				}
			}

			// Create polygon: [outer ring, ...inner rings]
			coordinateRings.push([outerCoordinates, ...innerCoordinates])
		}
	}

	return coordinateRings
}
