import type { LonLat, OsmRelation, OsmRelationMember, OsmWay } from "./types"

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
 *
 * This function handles:
 * - Ways that are reversed (end matches end, or start matches start).
 * - Closed ways (single ways that form a ring).
 * - Disconnected chains (multiple independent rings).
 */
export function connectWaysToRings(wayMembers: OsmWay[]): OsmWay[][] {
	if (wayMembers.length === 0) return []

	const rings: OsmWay[][] = []
	const used = new Set<number>()
	const wayMap = new Map<number, OsmWay>()

	// Build map of way ID to member
	for (const member of wayMembers) {
		wayMap.set(member.id, member)
	}

	// Helper to reverse a way's refs
	const reverseWay = (way: OsmWay): OsmWay => ({
		...way,
		refs: [...way.refs].reverse(),
	})

	// Build rings by connecting ways
	for (const startWay of wayMembers) {
		if (used.has(startWay.id)) continue
		if (startWay.refs.length < 2) throw Error("Way has less than 2 refs")

		const ring: OsmWay[] = [startWay]
		used.add(startWay.id)

		let currentStart = startWay.refs[0]!
		let currentEnd = startWay.refs[startWay.refs.length - 1]!

		// Try to extend the ring forward
		while (true) {
			let found = false
			for (const nextWay of wayMembers) {
				if (used.has(nextWay.id)) continue
				if (nextWay.refs.length < 2) throw Error("Way has less than 2 refs")
				const nextStart = nextWay.refs[0]!
				const nextEnd = nextWay.refs[nextWay.refs.length - 1]!

				// Check if next way connects to current end
				if (currentEnd === nextStart) {
					ring.push(nextWay)
					used.add(nextWay.id)
					currentEnd = nextEnd
					found = true
					break
				}
				if (currentEnd === nextEnd) {
					// Need to reverse next way
					ring.push(reverseWay(nextWay))
					used.add(nextWay.id)
					currentEnd = nextStart
					found = true
					break
				}
			}

			if (!found) break
		}

		// Try to extend the ring backward
		currentStart = startWay.refs[0]!
		currentEnd = startWay.refs[startWay.refs.length - 1]!

		while (true) {
			let found = false
			for (const nextWay of wayMembers) {
				if (used.has(nextWay.id)) continue
				if (nextWay.refs.length < 2) throw Error("Way has less than 2 refs")

				const nextStart = nextWay.refs[0]!
				const nextEnd = nextWay.refs[nextWay.refs.length - 1]!

				// Check if next way connects to current start
				if (currentStart === nextEnd) {
					ring.unshift(nextWay)
					used.add(nextWay.id)
					currentStart = nextStart
					found = true
					break
				}
				if (currentStart === nextStart) {
					// Need to reverse next way
					ring.unshift(reverseWay(nextWay))
					used.add(nextWay.id)
					currentStart = nextEnd
					found = true
					break
				}
			}

			if (!found) break
		}

		// Only add ring if it's closed (first and last node are the same)
		if (ring.length > 0) {
			const firstWay = ring[0]
			const lastWay = ring[ring.length - 1]
			if (firstWay?.refs[0] === lastWay?.refs[lastWay.refs.length - 1]) {
				rings.push(ring)
			}
		}
	}

	return rings
}

/**
 * Build polygon rings from way members of a relation.
 * Returns an array where each element is an array of coordinate rings (outer + inner).
 *
 * Based on OSM multipolygon relation specification:
 * https://wiki.openstreetmap.org/wiki/Relation:multipolygon
 *
 * This implementation connects way members into closed rings, and then groups them
 * into polygons. Currently, it associates all inner rings with every outer ring
 * found in the relation, which is a simplification. A robust implementation would
 * use point-in-polygon checks to strictly nest holes inside their parent outer ring.
 */
export function buildRelationRings(
	relation: OsmRelation,
	getWay: (wayId: number) => OsmWay | null,
	getNodeCoordinates: (nodeId: number) => LonLat | undefined,
): LonLat[][][] {
	const { outer, inner } = getWayMembersByRole(relation)

	// Connect outer ways into rings
	const outerRings = connectWaysToRings(
		outer.map((m) => getWay(m.ref)).filter((w) => w !== null),
	)
	// Connect inner ways into rings
	const innerRings = connectWaysToRings(
		inner.map((m) => getWay(m.ref)).filter((w) => w !== null),
	)

	const wayRingToCoords = (ring: OsmWay[]): LonLat[] => {
		const coords: LonLat[] = []
		for (const way of ring) {
			for (const nodeId of way.refs) {
				const coord = getNodeCoordinates(nodeId)
				if (coord) coords.push(coord)
			}
		}

		// Ensure ring is closed
		if (coords.length > 0) {
			const first = coords[0]
			const last = coords[coords.length - 1]
			if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
				coords.push([first[0], first[1]])
			}
		}
		return coords
	}

	// Convert way rings to coordinate rings
	const coordinateRings: LonLat[][][] = []

	for (const outerRing of outerRings) {
		const outerCoordinates: LonLat[] = wayRingToCoords(outerRing)

		if (outerCoordinates.length >= 3) {
			// Find inner rings that belong to this outer ring
			const innerCoordinates: LonLat[][] = []
			for (const innerRing of innerRings) {
				const innerCoords: LonLat[] = wayRingToCoords(innerRing)

				if (innerCoords.length >= 3) {
					// TODO: do proper point-in-polygon test with https://github.com/rowanwins/point-in-polygon-hao
					innerCoordinates.push(innerCoords)
				}
			}

			// Create polygon: [outer ring, ...inner rings]
			coordinateRings.push([outerCoordinates, ...innerCoordinates])
		}
	}

	return coordinateRings
}
