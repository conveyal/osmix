import type { Osm } from "./osm"
import { generateOsmChanges } from "./osm-change"

/**
 * Merge two OSM objects. Steps:
 * 1. Generate OSM changes from the patch OSM to the base OSM (create new entities and overwrite existing ones with same IDs).
 * 2. Apply the changes to the base OSM.
 * 3. Build spatial indexes for speeding up queries.
 * 4. Deduplicate nodes that are geographically identical.
 * 5. Search all new ways for intersection points with existing ways.
 * 6. Insert intersection nodes into the ways, create new nodes if needed.
 * // TODO handle over/under passes with tags
 * @param baseOsm - The base OSM object
 * @param patchOsm - The patch OSM object
 * @param log - The log function
 * @returns The merged OSM object
 */
export function mergeOsm(baseOsm: Osm, patchOsm: Osm, log = console.log) {
	const changes = generateOsmChanges(baseOsm, patchOsm)
	log(`Applying ${changes.length} changes from patch OSM to base OSM.`)
	baseOsm.applyChanges(changes)

	log("Building node spatial index.")
	baseOsm.loadNodeSpatialIndex()

	log("Merging overlapping nodes.")
	const dedupeResults = baseOsm.dedupeOverlappingNodes(patchOsm.nodes)

	if (dedupeResults.replaced > 0) {
		log(
			`Deduplicated overlapping nodes. Replaced ${dedupeResults.replaced} nodes and deleted ${dedupeResults.deleted} nodes.`,
		)
		log("Rebuilding node spatial index.")
		baseOsm.loadNodeSpatialIndex()
	} else {
		log("No overlapping nodes found.")
	}

	log("Searching for intersecting ways. Building way spatial index.")
	baseOsm.loadWaySpatialIndex()
	// Find intersecting way IDs. Each way should have at least one intersecting way or it is disconnected from the rest of the network.
	console.time("osm.ts:findIntersectionCandidatesForWays")
	const { intersectionCandidates, disconnectedWays } =
		baseOsm.findIntersectionCandidatesForWays(patchOsm.ways)
	console.timeEnd("osm.ts:findIntersectionCandidatesForWays")

	let insertedNodes = 0
	let createdNodes = 0
	if (intersectionCandidates.size > 0) {
		console.time("osm.ts:insertIntersectionNodes")
		log(
			`Found ${intersectionCandidates.size} intersecting ways. Ensuring intersection nodes are present.`,
		)
		for (const [
			wayId,
			intersectingWayId,
			intersections,
		] of intersectionCandidates) {
			for (const { existingNode, coords } of intersections.map((p) =>
				baseOsm.pointToNode(p),
			)) {
				let node = existingNode
				if (existingNode == null) {
					createdNodes++
					node = baseOsm.createNode(coords)
				}
				if (node && baseOsm.insertNodeIntoWay(node.id, wayId)) insertedNodes++
				if (node && baseOsm.insertNodeIntoWay(node.id, intersectingWayId))
					insertedNodes++
			}
		}
		log(
			`Inserted ${insertedNodes} nodes and created ${createdNodes} new nodes.`,
		)
		console.timeEnd("osm.ts:insertIntersectionNodes")
	} else {
		log("No intersecting ways found.")
	}

	if (disconnectedWays.size > 0) {
		log(`Found ${disconnectedWays.size} disconnected ways.`)
	}

	log("Rebuilding node and way spatial indexes.")
	baseOsm.loadNodeSpatialIndex()
	baseOsm.loadWaySpatialIndex()

	return baseOsm
}
