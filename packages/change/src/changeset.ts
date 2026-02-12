/**
 * OSM changeset tracking and manipulation.
 *
 * The OsmChangeset class tracks creates, modifies, and deletes for nodes, ways,
 * and relations. It provides methods for deduplication, intersection creation,
 * and direct merging of OSM datasets.
 *
 * @module
 */

import type { IdOrIndex, Nodes, Osm, Ways } from "@osmix/core"
import type {
	OsmEntity,
	OsmEntityType,
	OsmEntityTypeMap,
	OsmNode,
	OsmWay,
} from "@osmix/shared/types"
import {
	entityPropertiesEqual,
	getEntityType,
	isWayEqual,
} from "@osmix/shared/utils"
import { dequal } from "dequal" // dequal/lite does not work with `TypedArray`s
import type {
	OsmChange,
	OsmChanges,
	OsmChangesetStats,
	OsmEntityRef,
} from "./types"
import {
	cleanCoords,
	entityHasTagValue,
	getEntityVersion,
	isWayIntersectionCandidate,
	nearestNodeOnWay,
	removeDuplicateAdjacentRelationMembers,
	removeDuplicateAdjacentWayRefs,
	waysIntersect,
	waysShouldConnect,
} from "./utils"

/**
 * Tracks changes to an OSM dataset and provides utilities for deduplication and merging.
 *
 * The changeset maintains a record of creates, modifies, and deletes for nodes, ways,
 * and relations. It is optimized to minimize full entity retrieval until necessary.
 */
export class OsmChangeset {
	nodeChanges: Record<number, OsmChange<OsmEntityTypeMap["node"]>> = {}
	wayChanges: Record<number, OsmChange<OsmEntityTypeMap["way"]>> = {}
	relationChanges: Record<number, OsmChange<OsmEntityTypeMap["relation"]>> = {}

	osm: Osm

	// Next node ID tracker for generating new IDs during intersection creation
	currentNodeId: number

	deduplicatedNodes = 0
	deduplicatedNodesReplaced = 0
	deduplicatedWays = 0
	intersectionPointsFound = 0
	intersectionNodesCreated = 0

	static fromJson(base: Osm, json: OsmChanges) {
		const changeset = new OsmChangeset(base)
		changeset.nodeChanges = json.nodes
		changeset.wayChanges = json.ways
		changeset.relationChanges = json.relations
		return changeset
	}

	constructor(base: Osm) {
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
			refs, // Refs can come from other datasets, useful for tracking provenance
		}
	}

	/**
	 * Add or update an `OsmChange` for a given entity.
	 * Requires the entity to exist in the base OSM dataset (or have a previous 'create' change).
	 *
	 * For augmented diffs, the `oldEntity` field captures the state of the entity before
	 * modification (the original entity from the base dataset).
	 */
	modify<T extends OsmEntityType>(
		type: T,
		id: number,
		modify: (entity: OsmEntityTypeMap[T]) => OsmEntityTypeMap[T],
	): void {
		if (this.changes(type)[id]?.changeType === "delete") {
			throw Error(
				`Cannot modify ${type} ${id}: entity is scheduled for deletion`,
			)
		}

		const changes = this.changes(type)
		const change = changes[id]
		const changeEntity = change
			? (change.entity as OsmEntityTypeMap[T])
			: undefined
		const existingEntity = changeEntity ?? this.getEntity(type, id)
		if (existingEntity == null) throw Error("Entity not found")

		// For augmented diffs: capture the original entity from the base dataset
		// if this is the first modification (not an update to an existing change).
		// If we already have a change, preserve the original oldEntity.
		const oldEntity =
			change?.oldEntity ?? (changeEntity ? undefined : existingEntity)

		changes[id] = {
			changeType: change?.changeType ?? "modify",
			entity: modify(existingEntity),
			osmId: this.osm.id, // If we're modifying an entity, it must exist in the base OSM
			oldEntity,
		}
	}

	getEntity<T extends OsmEntityType>(
		type: T,
		id: number,
	): OsmEntityTypeMap[T] | undefined {
		if (type === "node")
			return this.osm.nodes.get({ id }) as OsmEntityTypeMap[T]
		if (type === "way") return this.osm.ways.get({ id }) as OsmEntityTypeMap[T]
		if (type === "relation")
			return this.osm.relations.get({ id }) as OsmEntityTypeMap[T]
	}

	/**
	 * Schedule an entity for deletion.
	 *
	 * For augmented diffs, the `oldEntity` field is set to the entity being deleted,
	 * capturing its state before removal.
	 */
	delete(entity: OsmEntity, refs?: OsmEntityRef[]) {
		this.changes(getEntityType(entity))[entity.id] = {
			changeType: "delete",
			entity,
			refs,
			osmId: this.osm.id,
			oldEntity: entity, // For augmented diffs: capture the entity being deleted
		}
	}

	/**
	 * Check nodes for duplicates and consolidate them within this OSM dataset.
	 * This process helps merge disparate datasets that share common geometry.
	 *
	 * The algorithm:
	 * 1. Find all pairs of nodes at the same geographic location (within a tiny radius).
	 * 2. For each pair, determine which node to keep:
	 *    - Prefer higher version number.
	 *    - If versions are equal, prefer the node with more tags.
	 *    - If tags are equal, prefer the higher ID (deterministic tie-breaker).
	 * 3. Build a replacement map (deleted ID -> kept ID).
	 * 4. Flatten chains (e.g., if A->B and B->C, then A->C).
	 * 5. Schedule duplicate nodes for deletion.
	 * 6. Update all ways and relations to reference the kept nodes.
	 */
	deduplicateNodes(nodes: Nodes) {
		const checkedIdPairs = new IdPairs()
		const replacementMap = new Map<number, number>()

		// Find overlapping nodes and determine which to keep
		for (const node of nodes) {
			if (!this.osm.nodes.ids.has(node.id)) continue
			if (this.nodeChanges[node.id]?.changeType === "delete") continue

			// Use a tiny radius (1 meter = 0.001 km) to find nodes at effectively the same location
			const existingNodes = this.osm.nodes.findIndexesWithinRadius(
				node.lon,
				node.lat,
				0.001,
			)
			const existingNodeIds = existingNodes
				.map((index) => ({ id: this.osm.nodes.ids.at(index), index }))
				.filter((n) => n.id !== node.id && !checkedIdPairs.has(n.id, node.id))

			for (const { index: existingNodeIndex } of existingNodeIds) {
				const existingNode = this.osm.nodes.getByIndex(existingNodeIndex)
				if (existingNode == null) continue

				checkedIdPairs.add(existingNode.id, node.id)

				// Determine which node to keep using version/tags logic (same as deduplicateWay)
				const nodeVersion = getEntityVersion(node)
				const existingNodeVersion = getEntityVersion(existingNode)

				let nodeToKeep: number = node.id
				let nodeToDelete: number = existingNode.id

				// Check version - prefer higher version
				if (existingNodeVersion > nodeVersion) {
					// Existing node has higher version, keep existing node
					nodeToKeep = existingNode.id
					nodeToDelete = node.id
				} else if (nodeVersion === existingNodeVersion) {
					// Same version, keep node with more tags (>= comparison to match deduplicateWay)
					const nodeTagCount = Object.keys(node.tags ?? {}).length
					const existingNodeTagCount = Object.keys(
						existingNode.tags ?? {},
					).length
					if (existingNodeTagCount >= nodeTagCount) {
						// Existing node has same or more tags, keep existing node
						// If equal tags, use higher ID for normalization
						if (existingNodeTagCount === nodeTagCount) {
							nodeToKeep = Math.max(node.id, existingNode.id)
							nodeToDelete = Math.min(node.id, existingNode.id)
						} else {
							nodeToKeep = existingNode.id
							nodeToDelete = node.id
						}
					}
				}

				// Add to replacement map (deleted node -> kept node)
				replacementMap.set(nodeToDelete, nodeToKeep)
			}
		}

		// Flatten deletion chains
		const flattenedMap = new Map<number, number>()
		for (const [fromId, toId] of replacementMap.entries()) {
			let finalId = toId
			const visited = new Set<number>([fromId])
			while (replacementMap.has(finalId) && !visited.has(finalId)) {
				visited.add(finalId)
				finalId = replacementMap.get(finalId)!
			}
			flattenedMap.set(fromId, finalId)

			// Schedule nodes for deletion
			const nodeToDelete = this.osm.nodes.getById(fromId)
			if (nodeToDelete) {
				this.deduplicatedNodes++
				this.delete(nodeToDelete, [
					{ type: "node", id: toId, osmId: this.osm.id },
				])
			}
		}

		this.applyNodeReplacementsToWays(flattenedMap)
		this.applyNodeReplacementsToRelations(flattenedMap)
		return flattenedMap
	}

	/**
	 * Apply node replacements to all ways in the OSM dataset.
	 * Returns the total number of node references replaced.
	 */
	private applyNodeReplacementsToWays(
		replacementMap: Map<number, number>,
	): number {
		let replacedCount = 0

		for (let wayIndex = 0; wayIndex < this.osm.ways.size; wayIndex++) {
			const way = this.osm.ways.getByIndex(wayIndex)
			let hasReplacement = false
			const newRefs = way.refs.map((ref) => {
				const replacement = replacementMap.get(ref)
				if (replacement) {
					hasReplacement = true
					replacedCount++
					return replacement
				}
				return ref
			})

			if (hasReplacement) {
				this.modify("way", way.id, (way) =>
					removeDuplicateAdjacentWayRefs({
						...way,
						refs: newRefs,
					}),
				)
			}
		}

		this.deduplicatedNodesReplaced += replacedCount
		return replacedCount
	}

	/**
	 * Apply node replacements to all relations in the OSM dataset.
	 * Returns the total number of node member references replaced.
	 */
	private applyNodeReplacementsToRelations(
		replacementMap: Map<number, number>,
	): number {
		let replacedCount = 0

		for (
			let relationIndex = 0;
			relationIndex < this.osm.relations.size;
			relationIndex++
		) {
			const relation = this.osm.relations.getByIndex(relationIndex)
			let hasReplacement = false
			const newMembers = relation.members.map((member) => {
				const replacement = replacementMap.get(member.ref)
				if (replacement) {
					hasReplacement = true
					replacedCount++
					return { ...member, ref: replacement }
				}
				return member
			})

			if (hasReplacement) {
				this.modify("relation", relation.id, (relation) =>
					removeDuplicateAdjacentRelationMembers({
						...relation,
						members: newMembers,
					}),
				)
			}
		}

		this.deduplicatedNodesReplaced += replacedCount
		return replacedCount
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
	 * Deduplicate a way by comparing it with existing ways in the OSM dataset.
	 * When a duplicate way is found, the patch way is deleted and references point to the kept way.
	 *
	 * Duplication criteria:
	 * - Geometrically identical (same coordinates).
	 * - Properties (except ID) must be roughly compatible.
	 * - Keeps the way with the higher version or more tags.
	 *
	 * Note: When a way is deduplicated, relations that reference the deleted way are not
	 * automatically updated to reference the kept way. This is a known limitation.
	 * Relations should be processed separately after way deduplication if this behavior is needed.
	 */
	deduplicateWay(patchWay: OsmWay, dedupedIdPairs: IdPairs) {
		const wayIndex = this.osm.ways.ids.getIndexFromId(patchWay.id)
		const wayCoords = this.osm.ways.getCoordinates(wayIndex)

		// Look for duplicate ways in OSM index
		const closeWayIndexes = this.osm.ways.intersects(
			this.osm.ways.getEntityBbox(patchWay),
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
				const coords = this.osm.ways.getCoordinates(index)
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

	/**
	 * Generator that creates intersection nodes for ways that cross each other.
	 * Yields statistics for each way processed, including intersection points found and nodes created.
	 *
	 * @param ways - The ways to process for intersections
	 * @yields Statistics object with `intersectionsFound` and `intersectionsCreated` counts
	 */
	*createIntersectionsForWaysGenerator(ways: Ways) {
		const wayIdPairs = new IdPairs()
		for (const way of ways) {
			if (!this.osm.ways.ids.has(way.id)) continue
			yield this.createIntersectionsForWay({ id: way.id }, wayIdPairs)
		}
	}

	createIntersectionsForWays(ways: Ways) {
		for (const _ of this.createIntersectionsForWaysGenerator(ways));
	}

	/**
	 * Create intersections for a single way.
	 * - Finds other ways that intersect the given way's bounding box.
	 * - Checks if they should connect (e.g. both are highways/paths, not tunnels/bridges).
	 * - Calculates intersection points.
	 * - Inserts existing nodes or creates new intersection nodes at the crossing points.
	 */
	createIntersectionsForWay(wayIdOrIndex: IdOrIndex, wayIdPairs: IdPairs) {
		let intersectionsFound = 0
		let intersectionsCreated = 0

		// Get the actual way from the OSM data (which may have been modified by deduplication)
		const [wayIndex] = this.osm.ways.ids.idOrIndex(wayIdOrIndex)
		const way = this.osm.ways.getByIndex(wayIndex)
		if (!isWayIntersectionCandidate(way)) return

		// Check for intersecting ways. Since the way exists in the base OSM, there will always be at least one way.
		const bbox = this.osm.ways.getEntityBbox({ index: wayIndex })
		const intersectingWayIndexes = this.osm.ways.intersects(bbox)
		if (intersectingWayIndexes.length <= 1) return // No candidates

		const coordinates = cleanCoords(this.osm.ways.getCoordinates(wayIndex))
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
				this.osm.ways.getCoordinates(intersectingWayIndex),
			)

			// Skip ways that are geometrically equal
			if (dequal(coordinates, intersectingWayCoords)) continue

			const intersectingPoints = waysIntersect(
				coordinates,
				intersectingWayCoords,
			)
			for (const pt of intersectingPoints) {
				const intersectingWayNodeId = nearestNodeOnWay(
					intersectingWay,
					intersectingWayCoords,
					pt,
				).nodeId
				const wayNodeId = nearestNodeOnWay(way, coordinates, pt).nodeId

				// If both ways already share the same node at this intersection,
				// just add the crossing tag (if needed) but don't count as an intersection.
				if (
					wayNodeId &&
					intersectingWayNodeId &&
					wayNodeId === intersectingWayNodeId
				) {
					const sharedNode = this.osm.nodes.getById(wayNodeId)
					if (sharedNode && !entityHasTagValue(sharedNode, "crossing", "yes")) {
						this.modify("node", sharedNode.id, (node) => {
							return {
								...node,
								tags: { ...node.tags, crossing: "yes" },
							}
						})
					}
					continue
				}

				intersectionsFound++

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

					if (!entityHasTagValue(wayNode, "crossing", "yes")) {
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
					if (!entityHasTagValue(intersectingWayNode, "crossing", "yes")) {
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
			const { refIndex } = nearestNodeOnWay(
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
	 *
	 * Implementation notes:
	 * - Ways are processed before nodes to improve node deduplication accuracy (see comment on line 633).
	 * - Node replacements in relations are handled by `applyNodeReplacementsToRelations()` when
	 *   deduplicating nodes, but relation member updates during direct merge are not automatically
	 *   handled. Use `deduplicateNodes()` after `generateDirectChanges()` if relation updates are needed.
	 */
	generateDirectChanges(patch: Osm) {
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
						removeDuplicateAdjacentWayRefs(way),
					)
				}
			} else {
				// Create the way
				this.create(removeDuplicateAdjacentWayRefs(way), patch.id)
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
