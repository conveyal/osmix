import type {
	LonLat,
	OsmRelation,
	OsmRelationMember,
	OsmWay,
	RelationKind,
	RelationKindMetadata,
} from "./types"

/**
 * Get the semantic kind of a relation based on its type tag.
 * Based on [OSM relation documentation](https://wiki.openstreetmap.org/wiki/Relation):
 * - Areas: multipolygon, boundary, site
 * - Lines: route, waterway, multilinestring, canal
 * - Points: multipoint
 * - Logic: restriction, route_master, network, collection
 * - [Super: relations that contain other relations](https://wiki.openstreetmap.org/wiki/Super-relation)
 */
export function getRelationKind(relation: OsmRelation): RelationKind {
	const typeTag = relation.tags?.["type"]
	if (!typeTag || typeof typeTag !== "string") {
		// If no type tag, check if it has relation members (super-relation)
		if (relation.members.some((m) => m.type === "relation")) {
			return "super"
		}
		// Default to logic for untyped relations
		return "logic"
	}

	const normalizedType = typeTag.toLowerCase()

	// Area relations
	if (
		normalizedType === "multipolygon" ||
		normalizedType === "boundary" ||
		normalizedType === "site"
	) {
		return "area"
	}

	// Line relations
	if (
		normalizedType === "route" ||
		normalizedType === "waterway" ||
		normalizedType === "multilinestring" ||
		normalizedType === "canal"
	) {
		return "line"
	}

	// Point relations
	if (normalizedType === "multipoint") {
		return "point"
	}

	// Check for super-relation (has relation members)
	if (relation.members.some((m) => m.type === "relation")) {
		return "super"
	}

	// Default to logic for other types (restriction, route_master, network, collection, etc.)
	return "logic"
}

/**
 * Get metadata about a relation kind.
 */
export function getRelationKindMetadata(
	relation: OsmRelation,
): RelationKindMetadata {
	const kind = getRelationKind(relation)

	switch (kind) {
		case "area":
			return {
				kind: "area",
				expectedRoles: ["outer", "inner"],
				orderMatters: false,
				description: "Area relation (multipolygon, boundary, site)",
			}
		case "line":
			return {
				kind: "line",
				expectedRoles: undefined, // Routes can have various roles
				orderMatters: true,
				description: "Line relation (route, waterway, multilinestring)",
			}
		case "point":
			return {
				kind: "point",
				expectedRoles: undefined,
				orderMatters: false,
				description: "Point relation (multipoint)",
			}
		case "super":
			return {
				kind: "super",
				expectedRoles: undefined,
				orderMatters: false,
				description: "Super-relation (contains other relations)",
			}
		case "logic":
			return {
				kind: "logic",
				expectedRoles: undefined,
				orderMatters: false,
				description:
					"Logical relation (restriction, route_master, network, collection, etc.)",
			}
	}
}

/**
 * Check if a relation is an area relation.
 */
export function isAreaRelation(relation: OsmRelation): boolean {
	return getRelationKind(relation) === "area"
}

/**
 * Check if a relation is a line relation.
 */
export function isLineRelation(relation: OsmRelation): boolean {
	return getRelationKind(relation) === "line"
}

/**
 * Check if a relation is a point relation.
 */
export function isPointRelation(relation: OsmRelation): boolean {
	return getRelationKind(relation) === "point"
}

/**
 * Check if a relation is a super-relation (contains other relations).
 */
export function isSuperRelation(relation: OsmRelation): boolean {
	return getRelationKind(relation) === "super"
}

/**
 * Check if a relation is a logical relation (non-geometric).
 */
export function isLogicRelation(relation: OsmRelation): boolean {
	return getRelationKind(relation) === "logic"
}

/**
 * Build MultiLineString geometry from a line relation by connecting way members.
 * Orders way members using their refs and handles role-based reversal.
 * Returns an array of LineString coordinates (each LineString is an array of LonLat).
 */
export function buildRelationLineStrings(
	relation: OsmRelation,
	getWay: (wayId: number) => OsmWay | null,
	getNodeCoordinates: (nodeId: number) => LonLat | undefined,
): LonLat[][] {
	const lineStrings: LonLat[][] = []
	const wayMembers = relation.members.filter((m) => m.type === "way")

	if (wayMembers.length === 0) return lineStrings

	// Group ways by role if roles are used
	const roleGroups = new Map<string, OsmRelationMember[]>()
	for (const member of wayMembers) {
		const role = member.role?.toLowerCase() ?? ""
		if (!roleGroups.has(role)) {
			roleGroups.set(role, [])
		}
		roleGroups.get(role)!.push(member)
	}

	// If no roles or single role group, process all ways together
	const groupsToProcess =
		roleGroups.size === 1 || !relation.members.some((m) => m.role)
			? [wayMembers]
			: Array.from(roleGroups.values())

	for (const group of groupsToProcess) {
		// Try to connect ways into continuous linestrings
		const connected = connectWaysToLineStrings(
			group,
			getWay,
			getNodeCoordinates,
		)
		lineStrings.push(...connected)
	}

	return lineStrings
}

/**
 * Connect ways that share endpoints to form continuous LineStrings.
 * Returns an array of LineStrings (each is an array of LonLat coordinates).
 */
function connectWaysToLineStrings(
	wayMembers: OsmRelationMember[],
	getWay: (wayId: number) => OsmWay | null,
	getNodeCoordinates: (nodeId: number) => LonLat | undefined,
): LonLat[][] {
	if (wayMembers.length === 0) return []

	const lineStrings: LonLat[][] = []
	const used = new Set<number>()
	const wayMap = new Map<number, OsmWay>()

	// Build map of way ID to way
	for (const member of wayMembers) {
		const way = getWay(member.ref)
		if (way) {
			wayMap.set(member.ref, way)
		}
	}

	// Build linestrings by connecting ways
	for (const member of wayMembers) {
		if (used.has(member.ref)) continue
		const startWay = wayMap.get(member.ref)
		if (!startWay || startWay.refs.length < 2) continue

		const coords: LonLat[] = []
		const currentWay = startWay
		used.add(member.ref)

		// Get coordinates for the starting way
		for (const nodeId of currentWay.refs) {
			const coord = getNodeCoordinates(nodeId)
			if (coord) coords.push(coord)
		}

		// Try to extend forward
		while (true) {
			let found = false
			const lastCoord = coords[coords.length - 1]
			if (!lastCoord) break

			for (const nextMember of wayMembers) {
				if (used.has(nextMember.ref)) continue
				const nextWay = wayMap.get(nextMember.ref)
				if (!nextWay || nextWay.refs.length < 2) continue

				const nextStart = getNodeCoordinates(nextWay.refs[0]!)
				const nextEnd = getNodeCoordinates(
					nextWay.refs[nextWay.refs.length - 1]!,
				)

				if (!nextStart || !nextEnd) continue

				// Check if next way connects to current end
				if (lastCoord[0] === nextStart[0] && lastCoord[1] === nextStart[1]) {
					// Connect normally
					for (let i = 1; i < nextWay.refs.length; i++) {
						const nodeId = nextWay.refs[i]
						if (nodeId === undefined) continue
						const coord = getNodeCoordinates(nodeId)
						if (coord) coords.push(coord)
					}
					used.add(nextMember.ref)
					found = true
					break
				}
				if (lastCoord[0] === nextEnd[0] && lastCoord[1] === nextEnd[1]) {
					// Need to reverse next way
					for (let i = nextWay.refs.length - 2; i >= 0; i--) {
						const nodeId = nextWay.refs[i]
						if (nodeId === undefined) continue
						const coord = getNodeCoordinates(nodeId)
						if (coord) coords.push(coord)
					}
					used.add(nextMember.ref)
					found = true
					break
				}
			}

			if (!found) break
		}

		// Try to extend backward
		while (true) {
			let found = false
			const firstCoord = coords[0]
			if (!firstCoord) break

			for (const prevMember of wayMembers) {
				if (used.has(prevMember.ref)) continue
				const prevWay = wayMap.get(prevMember.ref)
				if (!prevWay || prevWay.refs.length < 2) continue

				const prevStart = getNodeCoordinates(prevWay.refs[0]!)
				const prevEnd = getNodeCoordinates(
					prevWay.refs[prevWay.refs.length - 1]!,
				)

				if (!prevStart || !prevEnd) continue

				// Check if prev way connects to current start
				if (firstCoord[0] === prevEnd[0] && firstCoord[1] === prevEnd[1]) {
					// Connect normally (prepend)
					const newCoords: LonLat[] = []
					for (let i = 0; i < prevWay.refs.length - 1; i++) {
						const nodeId = prevWay.refs[i]
						if (nodeId === undefined) continue
						const coord = getNodeCoordinates(nodeId)
						if (coord) newCoords.push(coord)
					}
					coords.unshift(...newCoords)
					used.add(prevMember.ref)
					found = true
					break
				}
				if (firstCoord[0] === prevStart[0] && firstCoord[1] === prevStart[1]) {
					// Need to reverse prev way (prepend reversed)
					const newCoords: LonLat[] = []
					for (let i = prevWay.refs.length - 1; i > 0; i--) {
						const nodeId = prevWay.refs[i]
						if (nodeId === undefined) continue
						const coord = getNodeCoordinates(nodeId)
						if (coord) newCoords.push(coord)
					}
					coords.unshift(...newCoords)
					used.add(prevMember.ref)
					found = true
					break
				}
			}

			if (!found) break
		}

		if (coords.length >= 2) {
			lineStrings.push(coords)
		}
	}

	return lineStrings
}

/**
 * Collect point coordinates from a point relation.
 * Returns an array of LonLat coordinates from node members.
 */
export function collectRelationPoints(
	relation: OsmRelation,
	getNodeCoordinates: (nodeId: number) => LonLat | undefined,
): LonLat[] {
	const points: LonLat[] = []
	for (const member of relation.members) {
		if (member.type === "node") {
			const coord = getNodeCoordinates(member.ref)
			if (coord) {
				points.push(coord)
			}
		}
	}
	return points
}

/**
 * Resolve nested relation members, flattening the hierarchy with cycle detection.
 * Returns all nodes, ways, and relations that are members (directly or indirectly).
 * @param relation - The relation to resolve
 * @param getRelation - Function to get a relation by ID
 * @param maxDepth - Maximum recursion depth (default: 10)
 * @param visited - Set of relation IDs already visited (for cycle detection)
 */
export function resolveRelationMembers(
	relation: OsmRelation,
	getRelation: (relationId: number) => OsmRelation | null,
	maxDepth = 10,
	visited = new Set<number>(),
): {
	nodes: number[]
	ways: number[]
	relations: number[]
} {
	const nodes = new Set<number>()
	const ways = new Set<number>()
	const relations = new Set<number>()

	// Cycle detection or max depth reached
	if (visited.has(relation.id) || maxDepth <= 0) {
		return { nodes: [], ways: [], relations: [] }
	}

	visited.add(relation.id)

	for (const member of relation.members) {
		if (member.type === "node") {
			if (!nodes.has(member.ref)) {
				nodes.add(member.ref)
			}
		} else if (member.type === "way") {
			if (!ways.has(member.ref)) {
				ways.add(member.ref)
			}
		} else if (member.type === "relation") {
			if (!relations.has(member.ref)) {
				relations.add(member.ref)

				// Recursively resolve nested relation
				const nestedRelation = getRelation(member.ref)
				if (nestedRelation) {
					const nested = resolveRelationMembers(
						nestedRelation,
						getRelation,
						maxDepth - 1,
						visited,
					)
					// Merge nested results
					for (const nodeId of nested.nodes) {
						if (!nodes.has(nodeId)) {
							nodes.add(nodeId)
						}
					}
					for (const wayId of nested.ways) {
						if (!ways.has(wayId)) {
							ways.add(wayId)
						}
					}
					for (const relId of nested.relations) {
						if (!relations.has(relId)) {
							relations.add(relId)
						}
					}
				}
			}
		}
	}

	return {
		nodes: Array.from(nodes),
		ways: Array.from(ways),
		relations: Array.from(relations),
	}
}
