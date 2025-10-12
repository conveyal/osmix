import {
	entityPropertiesEqual,
	getEntityType,
	isWayEqual,
	type OsmEntity,
	type OsmEntityType,
	type OsmEntityTypeMap,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
} from "@osmix/json"
import { dequal } from "dequal" // dequal/lite does not work with `TypedArray`s
import sweeplineIntersections from "sweepline-intersections"
import type { Nodes } from "./nodes"
import { Osmix } from "./osmix"
import type { OsmChange, OsmEntityRef } from "./types"
import {
	cleanCoords,
	haversineDistance,
	isWayIntersectionCandidate,
	osmTagsToOscTags,
	removeDuplicateAdjacentOsmWayRefs,
	waysShouldConnect,
} from "./utils"
import type { Ways } from "./ways"

export interface OsmMergeOptions {
	directMerge: boolean
	deduplicateNodes: boolean
	deduplicateWays: boolean
	createIntersections: boolean
}

export type OsmChangesetStats = {
	osmId: string
	totalChanges: number
	nodeChanges: number
	wayChanges: number
	relationChanges: number
	deduplicatedNodes: number
	deduplicatedNodesReplaced: number
	deduplicatedWays: number
	intersectionPointsFound: number
	intersectionNodesCreated: number
}

export type OsmChanges = {
	osmId: string
	nodes: Record<number, OsmChange<OsmEntityTypeMap["node"]>>
	ways: Record<number, OsmChange<OsmEntityTypeMap["way"]>>
	relations: Record<number, OsmChange<OsmEntityTypeMap["relation"]>>
	stats: OsmChangesetStats
}

export type OsmChangeTypes = "modify" | "create" | "delete"

/**
 * Each step is optimized to minimize the retrieval of the full entity data.
 */
export default class OsmChangeset {
	nodeChanges: Record<number, OsmChange<OsmEntityTypeMap["node"]>> = {}
	wayChanges: Record<number, OsmChange<OsmEntityTypeMap["way"]>> = {}
	relationChanges: Record<number, OsmChange<OsmEntityTypeMap["relation"]>> = {}

	osm: Osmix

	// Next node ID
	currentNodeId: number

	deduplicatedNodes = 0
	deduplicatedNodesReplaced = 0
	deduplicatedWays = 0
	intersectionPointsFound = 0
	intersectionNodesCreated = 0

	static fromJson(base: Osmix, json: OsmChanges) {
		const changeset = new OsmChangeset(base)
		changeset.nodeChanges = json.nodes
		changeset.wayChanges = json.ways
		changeset.relationChanges = json.relations
		return changeset
	}

	constructor(base: Osmix) {
		this.osm = base
		this.currentNodeId = base.nodes.ids.at(-1)
	}

	get stats(): OsmChangesetStats {
		const nodeChanges = Object.values(this.nodeChanges).length
		const wayChanges = Object.values(this.wayChanges).length
		const relationChanges = Object.values(this.relationChanges).length
		return {
			osmId: this.osm.id,
			totalChanges: nodeChanges + wayChanges + relationChanges,
			nodeChanges,
			wayChanges,
			relationChanges,
			deduplicatedNodes: this.deduplicatedNodes,
			deduplicatedNodesReplaced: this.deduplicatedNodesReplaced,
			deduplicatedWays: this.deduplicatedWays,
			intersectionPointsFound: this.intersectionPointsFound,
			intersectionNodesCreated: this.intersectionNodesCreated,
		}
	}

	changes<T extends OsmEntityType>(
		type: T,
	): Record<number, OsmChange<OsmEntityTypeMap[T]>> {
		switch (type) {
			case "node":
				return this.nodeChanges as Record<
					number,
					OsmChange<OsmEntityTypeMap[T]>
				>
			case "way":
				return this.wayChanges as Record<number, OsmChange<OsmEntityTypeMap[T]>>
			case "relation":
				return this.relationChanges as Record<
					number,
					OsmChange<OsmEntityTypeMap[T]>
				>
		}
	}

	nextNodeId() {
		return ++this.currentNodeId
	}

	create(entity: OsmEntity, osmId: string, refs?: OsmEntityRef[]) {
		this.changes(getEntityType(entity))[entity.id] = {
			changeType: "create",
			entity,
			osmId,
			refs, // Refs can come from other datasets
		}
	}

	/**
	 * Add or update an `OsmChange` for a given entity. There must be an existing entity in the base OSM, otherwise a `create` change
	 * should have been used instead.
	 */
	modify<T extends OsmEntityType>(
		type: T,
		id: number,
		modify: (entity: OsmEntityTypeMap[T]) => OsmEntityTypeMap[T],
	): void {
		if (this.changes(type)[id]?.changeType === "delete") {
			console.error("Attempting to modify an entity scheduled for deletion", {
				type,
				id,
			})
			return
		}

		const changes = this.changes(type)
		const change = changes[id]
		const changeEntity = change
			? (change.entity as OsmEntityTypeMap[T])
			: undefined
		const existingEntity = changeEntity ?? this.osm.get(type, id)
		if (existingEntity == null) throw Error("Entity not found")
		changes[id] = {
			changeType: change?.changeType ?? "modify",
			entity: modify(existingEntity),
			osmId: this.osm.id, // If we're modifying an entity, it must exist in the base OSM
		}
	}

	delete(entity: OsmEntity, refs?: OsmEntityRef[]) {
		this.changes(getEntityType(entity))[entity.id] = {
			changeType: "delete",
			entity,
			refs,
			osmId: this.osm.id,
		}
	}

	/**
	 * Deduplicate a set of nodes within this OSM dataset.
	 */
	*deduplicateNodesGenerator(nodes: Nodes) {
		const dedupedIdPairs = new IdPairs()
		for (const node of nodes) {
			if (!this.osm.nodes.ids.has(node.id)) continue
			yield this.deduplicateOverlappingNodes(node, dedupedIdPairs)
		}
	}

	deduplicateNodes(nodes: Nodes) {
		for (const _ of this.deduplicateNodesGenerator(nodes));
	}

	/**
	 * De-duplicate a node within this OSM changeset by finding and consolidating nodes at the same geographic location.
	 *
	 * This function searches for existing nodes in the base OSM that occupy the exact same coordinates as the patch node.
	 * When duplicates are found, it replaces all references to the existing node with the patch node in ways and relations,
	 * then schedules the existing node for deletion.
	 *
	 * The algorithm:
	 * 1. Checks if the patch node has already been deduplicated or scheduled for deletion
	 * 2. Searches for existing nodes at the exact same coordinates (within radius 0)
	 * 3. For each duplicate found:
	 *    - Finds all ways containing the existing node and replaces references with the patch node
	 *    - Finds all relations containing the existing node and replaces member references with the patch node
	 *    - Schedules the existing node for deletion
	 *    - Skips deduplication if both nodes exist in the same way or relation (to avoid creating invalid geometry)
	 * 4. Returns the count of nodes that were replaced across all ways and relations
	 *
	 * @param patchNode - The node to deduplicate against existing nodes in the base OSM
	 * @param checkedIdPairs - Tracking set to avoid processing the same node pairs multiple times
	 * @returns The number of node references that were replaced in ways and relations
	 */
	deduplicateOverlappingNodes(patchNode: OsmNode, checkedIdPairs: IdPairs): number {
		const nodeId = patchNode.id

		// Has this node already been deduplicated? (scheduled for deletion)
		if (nodeId == null || this.nodeChanges[nodeId]?.changeType === "delete")
			return 0

		const ll = [patchNode.lon, patchNode.lat]
		const existingNodes = this.osm.nodes.withinRadius(ll[0], ll[1], 0)
		const existingNodeIds = existingNodes
			.map((index) => ({ id: this.osm.nodes.ids.at(index), index }))
			.filter((n) => n.id !== nodeId && !checkedIdPairs.has(n.id, nodeId))
		if (existingNodeIds.length === 0) return 0

		// Found a duplicate, load the full node
		let deduplicatedNodesReplaced = 0
		for (const { index: existingNodeIndex } of existingNodeIds) {
			const existingNode = this.osm.nodes.getByIndex(existingNodeIndex)
			if (existingNode == null) continue

			// Add this pair to the deduped ID pairs
			checkedIdPairs.add(existingNode.id, nodeId)

			const neigborWayIndexes = this.osm.ways.neighbors(
				patchNode.lon,
				patchNode.lat,
				20,
				0,
			)

			// Find ways that contain the replaced node
			const candidateWays: OsmWay[] = []
			for (const wayIndex of neigborWayIndexes) {
				const wayRefs = this.osm.ways.getRefIds(wayIndex)
				if (wayRefs.includes(existingNode.id)) {
					// Do not de-duplicate when both nodes exist in the same way
					if (wayRefs.includes(patchNode.id)) return 0
					const way = this.osm.ways.getByIndex(wayIndex)
					candidateWays.push(way)
				}
			}

			// Find relations that contain the replaced node
			const candidateRelations: OsmRelation[] = []
			for (
				let relationIndex = 0;
				relationIndex < this.osm.relations.ids.size;
				relationIndex++
			) {
				if (
					this.osm.relations.includesMember(
						relationIndex,
						existingNode.id,
						"node",
					)
				) {
					// Do not de-duplicate when both nodes exist in the same relation
					if (
						this.osm.relations.includesMember(
							relationIndex,
							patchNode.id,
							"node",
						)
					)
						return 0
					candidateRelations.push(this.osm.relations.getByIndex(relationIndex))
				}
			}

			// Modify ways that contain the replaced node
			for (const way of candidateWays) {
				deduplicatedNodesReplaced++
				this.modify("way", way.id, (way) => ({
					...way,
					refs: way.refs.map((ref) =>
						ref === existingNode.id ? patchNode.id : ref,
					),
				}))
			}

			// Modify relations that contain the replaced node
			for (const relation of candidateRelations) {
				deduplicatedNodesReplaced++
				this.modify("relation", relation.id, (relation) => ({
					...relation,
					members: relation.members.map((member) =>
						member.ref === existingNode.id
							? { ...member, ref: patchNode.id }
							: member,
					),
				}))
			}

			// Schedule node for deletion
			this.deduplicatedNodes++
			this.delete(existingNode, [
				{ type: "node", id: patchNode.id, osmId: this.osm.id },
			])
		}

		// Increment the total number of nodes replaced
		this.deduplicatedNodesReplaced += deduplicatedNodesReplaced
		return deduplicatedNodesReplaced
	}

	/**
	 * De-duplicate the ways within this OSM changeset.
	 */
	*deduplicateWaysGenerator(ways: Ways) {
		const dedupedIdPairs = new IdPairs()
		for (const way of ways) {
			if (!this.osm.ways.ids.has(way.id)) continue
			yield this.deduplicateWay(way, dedupedIdPairs)
		}
	}

	deduplicateWays(ways: Ways) {
		for (const _ of this.deduplicateWaysGenerator(ways));
	}

	/**
	 * TODO: replace refs in relations with new way
	 */
	deduplicateWay(patchWay: OsmWay, dedupedIdPairs: IdPairs) {
		const wayIndex = this.osm.ways.ids.getIndexFromId(patchWay.id)
		const wayCoords = this.osm.ways.getCoordinates(wayIndex, this.osm.nodes)

		// Look for duplicate ways in OSM index
		const closeWayIndexes = this.osm.ways.intersects(
			this.osm.ways.getBbox(patchWay),
		)
		const wayVersion = getEntityVersion(patchWay)
		const wayTagCount = Object.keys(patchWay.tags ?? {}).length
		const candidateDuplicateWays: OsmWay[] = closeWayIndexes
			.map((index) => {
				const otherWay = this.osm.ways.getByIndex(index)
				if (otherWay.id === patchWay.id) return null

				// Has this pair been deduped or checked already?
				if (dedupedIdPairs.has(patchWay.id, otherWay.id)) return null
				dedupedIdPairs.add(patchWay.id, otherWay.id)

				// Check if all way properties other than the ID are equal
				if (isWayEqual(patchWay, otherWay)) return otherWay

				// Check geometry
				const coords = this.osm.ways.getCoordinates(index, this.osm.nodes)
				if (!dequal(wayCoords, coords)) return null

				// Check version
				const otherWayVersion = getEntityVersion(otherWay)
				if (otherWayVersion < wayVersion) return null
				if (otherWayVersion > wayVersion) return otherWay

				// Ways are geometrically equal, with same version. Keep the way with more tags
				const tagCount = Object.keys(otherWay.tags ?? {}).length
				return tagCount >= wayTagCount ? otherWay : null
			})
			.filter((way) => way != null)

		if (candidateDuplicateWays.length === 0) return 0

		// Delete this way
		this.delete(
			patchWay,
			candidateDuplicateWays.map((way) => ({
				type: "way",
				id: way.id,
				osmId: this.osm.id,
			})),
		)
		this.deduplicatedWays++

		return candidateDuplicateWays.length
	}

	nearestNodeOnWay(
		way: OsmWay,
		wayCoords: [number, number][],
		point: [number, number],
		MAX_DISTANCE_METERS = 1,
	) {
		let nearestDistance = Number.POSITIVE_INFINITY
		let nearestNodeId = null
		let nearestNodeRefIndex = -1
		for (let i = 0; i < wayCoords.length; i++) {
			const nodeDistance = haversineDistance(wayCoords[i], point)
			if (
				nodeDistance < nearestDistance &&
				nodeDistance < MAX_DISTANCE_METERS
			) {
				nearestDistance = nodeDistance
				nearestNodeId = way.refs[i]
				nearestNodeRefIndex = i
			}
		}
		return {
			refIndex: nearestNodeRefIndex,
			nodeId: nearestNodeId,
		}
	}

	/**
	 *
	 * @param patch
	 */
	*createIntersectionsForWaysGenerator(ways: Ways) {
		const wayIdPairs = new IdPairs()
		for (const way of ways) {
			if (!isWayIntersectionCandidate(way)) continue
			if (!this.osm.ways.ids.has(way.id)) continue
			yield this.createIntersectionsForWay(way, wayIdPairs)
		}
	}

	createIntersectionsForWays(ways: Ways) {
		for (const _ of this.createIntersectionsForWaysGenerator(ways));
	}

	/**
	 * Way must exist in the base OSM. Add it first, if merging.
	 */
	createIntersectionsForWay(way: OsmWay, wayIdPairs: IdPairs) {
		let intersectionsFound = 0
		let intersectionsCreated = 0

		const wayIndex = this.osm.ways.ids.getIndexFromId(way.id)

		// Check for intersecting ways. Since the way exists in the base OSM, there will always be at least one way.
		const bbox = this.osm.ways.getBbox({ index: wayIndex })
		const intersectingWayIndexes = this.osm.ways.intersects(bbox)
		if (intersectingWayIndexes.length <= 1) return // No candidates

		const coordinates = cleanCoords(
			this.osm.ways.getCoordinates(wayIndex, this.osm.nodes),
		)

		for (const intersectingWayIndex of intersectingWayIndexes) {
			const intersectingWayId = this.osm.ways.ids.at(intersectingWayIndex)

			// Skip self and null ways
			if (intersectingWayId == null || intersectingWayId === way.id) continue
			if (wayIdPairs.has(way.id, intersectingWayId)) continue
			wayIdPairs.add(way.id, intersectingWayId)

			// Skip ways that aren't applicable for connecting
			const intersectingWay = this.osm.ways.getByIndex(intersectingWayIndex)
			if (!waysShouldConnect(way.tags, intersectingWay.tags)) continue

			const intersectingWayCoords = cleanCoords(
				this.osm.ways.getCoordinates(intersectingWayIndex, this.osm.nodes),
			)

			// Skip ways that are geometrically equal
			if (dequal(coordinates, intersectingWayCoords)) continue

			const intersectingPoints = waysIntersect(
				coordinates,
				intersectingWayCoords,
			)
			for (const pt of intersectingPoints) {
				intersectionsFound++

				const intersectingWayNodeId = this.nearestNodeOnWay(
					intersectingWay,
					intersectingWayCoords,
					pt,
				).nodeId
				const wayNodeId = this.nearestNodeOnWay(way, coordinates, pt).nodeId

				// Prefer the incoming way node, then the intersecting way node, then a new node.
				if (wayNodeId) {
					const wayNode = this.osm.nodes.getById(wayNodeId)
					if (wayNode == null) throw Error(`Way node ${wayNodeId} not found`)
					if (intersectingWayNodeId) {
						// Replace in intersecting way
						this.modify("way", intersectingWay.id, (way) => {
							return {
								...way,
								refs: way.refs.map((ref) =>
									ref === intersectingWayNodeId ? wayNodeId : ref,
								),
							}
						})
					} else {
						this.spliceNodeIntoWay(intersectingWay, wayNode)
					}

					if (wayNode.tags?.crossing !== "yes") {
						this.modify("node", wayNode.id, (node) => {
							return {
								...node,
								tags: { ...node.tags, crossing: "yes" },
							}
						})
					}
				} else if (intersectingWayNodeId) {
					const intersectingWayNode = this.osm.nodes.getById(
						intersectingWayNodeId,
					)
					if (intersectingWayNode == null)
						throw Error(
							`Intersecting way node ${intersectingWayNodeId} not found`,
						)

					this.spliceNodeIntoWay(way, intersectingWayNode)
					if (intersectingWayNode.tags?.crossing !== "yes") {
						this.modify("node", intersectingWayNode.id, (node) => {
							return {
								...node,
								tags: { ...node.tags, crossing: "yes" },
							}
						})
					}
				} else {
					intersectionsCreated++

					const newIntersectionNode: OsmNode = {
						id: this.nextNodeId(),
						lon: pt[0],
						lat: pt[1],
						tags: {
							crossing: "yes",
						},
					}
					this.create(newIntersectionNode, this.osm.id, [
						{ type: "way", id: way.id, osmId: this.osm.id },
						{ type: "way", id: intersectingWay.id, osmId: this.osm.id },
					])

					// Splice into the existing ways
					this.spliceNodeIntoWay(way, newIntersectionNode)
					this.spliceNodeIntoWay(intersectingWay, newIntersectionNode)
				}
			}
		}

		this.intersectionPointsFound += intersectionsFound
		this.intersectionNodesCreated += intersectionsCreated

		return {
			intersectionsFound,
			intersectionsCreated,
		}
	}

	/**
	 * We do not pass coordinates here because the way may have already been modified.
	 */
	spliceNodeIntoWay(way: OsmWay, node: OsmNode) {
		this.modify("way", way.id, (way) => {
			const coords = way.refs.map((ref) =>
				this.osm.nodes.getNodeLonLat({ id: ref }),
			)
			const { refIndex } = this.nearestNodeOnWay(
				way,
				coords,
				[node.lon, node.lat],
				Number.POSITIVE_INFINITY,
			)
			return {
				...way,
				refs: way.refs.toSpliced(refIndex, 0, node.id),
			}
		})
	}

	/**
	 * Create changes to merge nodes, ways, and relations from a patch OSM file into the base OSM.
	 * - Check for duplicate nodes in the patch, replace the existing nodes where appropriate.
	 * - Check for duplicate incoming ways, only add single instances of geometrically equal ways.
	 * TODOS:
	 * - If I add ways first, then nodes, the node de-duplication may work better. I can de-duplicate the nodes in the changesets.
	 * - Replace existing nodes in relations where appropriate.
	 */
	generateDirectChanges(patch: Osmix) {
		// Reset the current node ID to the highest node ID in the base or patch
		this.currentNodeId = Math.max(
			this.osm.nodes.ids.at(-1),
			patch.nodes.ids.at(-1),
		)

		// First, create or modify all ways in the patch
		for (let patchIndex = 0; patchIndex < patch.ways.size; patchIndex++) {
			const way = patch.ways.getByIndex(patchIndex)

			// Check for ways with exact IDs
			if (this.osm.ways.ids.has(way.id)) {
				const existingWay = this.osm.ways.getById(way.id)
				if (existingWay && !entityPropertiesEqual(existingWay, way)) {
					// Replace the existing entity with the patch entity
					this.modify("way", way.id, (_existingWay) =>
						removeDuplicateAdjacentOsmWayRefs(way),
					)
				}
			} else {
				// Create the way
				this.create(removeDuplicateAdjacentOsmWayRefs(way), patch.id)
			}
		}

		// Second, create or modify all nodes in the patch. This is after ways to properly de-duplicate nodes.
		for (const node of patch.nodes) {
			if (this.osm.nodes.ids.has(node.id)) {
				const existingNode = this.osm.nodes.getById(node.id)
				if (existingNode && !entityPropertiesEqual(existingNode, node)) {
					// Replace the existing entity with the patch entity
					this.modify("node", node.id, (_existingNode) => node)
				}
			} else {
				this.create(node, patch.id)
			}
		}

		for (const relation of patch.relations) {
			if (this.osm.relations.ids.has(relation.id)) {
				const existingRelation = this.osm.relations.getById(relation.id)
				if (
					existingRelation &&
					!entityPropertiesEqual(existingRelation, relation)
				) {
					// Replace the existing entity with the patch entity
					this.modify("relation", relation.id, (_existingRelation) => relation)
				}
			} else {
				this.create(relation, patch.id)
			}
		}
	}

	applyChanges(newId?: string) {
		return applyChangesetToOsm(this, newId)
	}

	// TODO: Finish this
	generateOscChanges() {
		let create = ""
		let modify = ""
		let del = ""

		for (const node of Object.values(this.nodeChanges)) {
			const tags = node.entity.tags ? osmTagsToOscTags(node.entity.tags) : ""
			if (node.changeType === "create") {
				create += `<node id="${node.entity.id}" lon="${node.entity.lon}" lat="${node.entity.lat}">${tags}</node>`
			} else if (node.changeType === "modify") {
				modify += `<node id="${node.entity.id}" lon="${node.entity.lon}" lat="${node.entity.lat}">${tags}</node>`
			} else if (node.changeType === "delete") {
				del += `<node id="${node.entity.id}" />`
			}
		}

		for (const way of Object.values(this.wayChanges)) {
			const tags = way.entity.tags ? osmTagsToOscTags(way.entity.tags) : ""
			const nodes = way.entity.refs.map((ref) => `<nd id="${ref}" />`).join("")
			if (way.changeType === "create") {
				create += `<way id="${way.entity.id}">${tags}${nodes}</way>`
			} else if (way.changeType === "modify") {
				modify += `<way id="${way.entity.id}">${tags}${nodes}</way>`
			} else if (way.changeType === "delete") {
				del += `<way id="${way.entity.id}" />`
			}
		}

		return `
			<osmChange version="0.6" generator="@osmix/core">
				<create>${create}</create>
				<modify>${modify}</modify>
				<delete>${del}</delete>
			</osmChange>
		`
	}
}

function getEntityVersion(entity: OsmEntity) {
	return entity.tags && "ext:osm_version" in entity.tags
		? Number(entity.tags["ext:osm_version"])
		: 0
}

/**
 * Check if the coordinates of two ways produce intersections.
 */
function waysIntersect(
	wayA: [number, number][],
	wayB: [number, number][],
): [number, number][] {
	const intersections = sweeplineIntersections(
		{
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: wayA,
					},
					properties: {},
				},
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: wayB,
					},
					properties: {},
				},
			],
		},
		true,
	)

	const uniqueFeatures: [number, number][] = []
	const seen = new Set<string>()

	for (const coordinates of intersections) {
		const key = `${coordinates[0]}:${coordinates[1]}`
		if (seen.has(key)) continue
		seen.add(key)
		uniqueFeatures.push(coordinates)
	}

	return uniqueFeatures
}

/**
 * Apply a changeset to an Osm index, generating a new Osm index. Usually done on a changeset made from the base osm index.
 */
export function applyChangesetToOsm(changeset: OsmChangeset, newId?: string) {
	const baseOsm = changeset.osm
	const osm = new Osmix({ id: newId ?? baseOsm.id, logger: baseOsm.log, header: baseOsm.header })

	const { nodeChanges, wayChanges, relationChanges } = changeset

	// Add nodes from base, modifying and deleting as needed
	for (const node of baseOsm.nodes) {
		const change = nodeChanges[node.id]
		if (change) {
			// Remove the change from the changeset so we don't apply it twice
			delete nodeChanges[node.id]
			if (change.changeType === "delete") continue // Don't add deleted nodes
			if (change.changeType === "create")
				throw Error("Changeset contains create changes for existing entities")
		}
		osm.nodes.addNode(change?.entity ?? node)
	}

	// All remaining node changes should be create
	// Add nodes from patch
	for (const change of Object.values(nodeChanges)) {
		if (change.changeType !== "create") {
			throw Error("Changeset still contains node changes in incorrect stage.")
		}
		osm.nodes.addNode(change.entity)
	}

	// Add ways from base, modifying and deleting as needed
	for (const way of baseOsm.ways) {
		const change = wayChanges[way.id]
		if (change) {
			// Remove the change from the changeset so we don't apply it twice
			delete wayChanges[way.id]
			if (change.changeType === "delete") continue // Don't add deleted ways
			if (change.changeType === "create") {
				throw Error("Changeset contains create changes for existing entities")
			}
		}
		// Remove duplicate refs back to back, but not when they are separated by other refs
		osm.ways.addWay(change?.entity ?? way)
	}

	// All remaining way changes should be create
	// Add ways from patch
	for (const change of Object.values(wayChanges)) {
		if (change.changeType !== "create")
			throw Error("Changeset still contains way changes in incorrect stage.")
		osm.ways.addWay(change.entity)
	}

	// Add relations from base, modifying and deleting as needed
	for (const relation of baseOsm.relations) {
		const change = relationChanges[relation.id]
		if (change) {
			// Remove the change from the changeset so we don't apply it twice
			delete relationChanges[relation.id]
			if (change.changeType === "delete") continue // Don't add deleted relations
			if (change.changeType === "create") {
				throw Error("Changeset contains create changes for existing entities")
			}
		}
		osm.relations.addRelation(change?.entity ?? relation)
	}

	// Add relations from patch
	for (const change of Object.values(relationChanges)) {
		if (change.changeType !== "create")
			throw Error(
				"Changeset still contains relation changes in incorrect stage.",
			)
		osm.relations.addRelation(change.entity)
	}

	// Everything should be added now, finish the osm
	osm.buildIndexes()

	return osm
}

class IdPairs {
	#idPairs = new Set<string>()

	#makeIdsKey(wayIds: number[]) {
		return wayIds.toSorted((a, b) => a - b).join(",")
	}

	add(...wayIds: number[]) {
		this.#idPairs.add(this.#makeIdsKey(wayIds))
	}

	has(...wayIds: number[]) {
		return this.#idPairs.has(this.#makeIdsKey(wayIds))
	}

	clear() {
		this.#idPairs.clear()
	}
}
