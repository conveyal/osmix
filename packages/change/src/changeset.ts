import type { Nodes, Osm, Ways } from "@osmix/core"
import { haversineDistance } from "@osmix/shared/haversine-distance"
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
import { applyChangesetToOsm } from "./apply-changeset"
import type {
	OsmChange,
	OsmChanges,
	OsmChangesetStats,
	OsmEntityRef,
} from "./types"
import {
	cleanCoords,
	entityHasTagValue,
	isWayIntersectionCandidate,
	osmTagsToOscTags,
	removeDuplicateAdjacentRelationMembers,
	removeDuplicateAdjacentWayRefs,
	waysIntersect,
	waysShouldConnect,
} from "./utils"

/**
 * Each step is optimized to minimize the retrieval of the full entity data.
 */
export class OsmChangeset {
	nodeChanges: Record<number, OsmChange<OsmEntityTypeMap["node"]>> = {}
	wayChanges: Record<number, OsmChange<OsmEntityTypeMap["way"]>> = {}
	relationChanges: Record<number, OsmChange<OsmEntityTypeMap["relation"]>> = {}

	osm: Osm

	// Next node ID
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
		const existingEntity = changeEntity ?? this.getEntity(type, id)
		if (existingEntity == null) throw Error("Entity not found")
		changes[id] = {
			changeType: change?.changeType ?? "modify",
			entity: modify(existingEntity),
			osmId: this.osm.id, // If we're modifying an entity, it must exist in the base OSM
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

	delete(entity: OsmEntity, refs?: OsmEntityRef[]) {
		this.changes(getEntityType(entity))[entity.id] = {
			changeType: "delete",
			entity,
			refs,
			osmId: this.osm.id,
		}
	}

	/**
	 * Check nodes for duplicates and consolidate them within this OSM dataset.
	 * All checked nodes must exist in the base OSM.
	 *
	 * The algorithm:
	 * - Build a map of node IDs that should be replaced with other node IDs.
	 *  	- Find all pairs of nodes at the same geographic location
	 *  	- For each pair, determine which node to keep based on version and tags
	 *  	- Normalize replacements so lower IDs are always replaced with higher IDs
	 * 		- Flatten chains (A→B, B→C becomes A→C, B→C)
	 * 		- Schedule nodes for deletion
	 * - Apply node replacements to ways
	 * - Apply node replacements to relations
	 */
	deduplicateNodes(nodes: Nodes) {
		const checkedIdPairs = new IdPairs()
		const replacementMap = new Map<number, number>()

		// Find overlapping nodes and determine which to keep
		for (const node of nodes) {
			if (!this.osm.nodes.ids.has(node.id)) continue
			if (this.nodeChanges[node.id]?.changeType === "delete") continue

			const existingNodes = this.osm.nodes.findIndexesWithinRadius(
				node.lon,
				node.lat,
				0,
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
	 * Note: When a way is deduplicated, relations that reference the deleted way are not
	 * automatically updated to reference the kept way. This is a known limitation.
	 * Relations should be processed separately after way deduplication if this behavior is needed.
	 */
	deduplicateWay(patchWay: OsmWay, dedupedIdPairs: IdPairs) {
		const wayIndex = this.osm.ways.ids.getIndexFromId(patchWay.id)
		const wayCoords = this.osm.ways.getCoordinates(wayIndex)

		// Look for duplicate ways in OSM index
		const closeWayIndexes = this.osm.ways.intersects(
			this.osm.ways.getNodeBbox(patchWay),
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

	nearestNodeOnWay(
		way: OsmWay,
		wayCoords: [number, number][],
		point: [number, number],
		MAX_DISTANCE_METERS = 1,
	) {
		let nearestDistance = Number.POSITIVE_INFINITY
		let nearestNodeId = null
		let nearestNodeRefIndex = -1
		wayCoords.forEach((wayCoord, i) => {
			const nodeDistance = haversineDistance(wayCoord, point)
			if (
				nodeDistance < nearestDistance &&
				nodeDistance < MAX_DISTANCE_METERS
			) {
				nearestDistance = nodeDistance
				nearestNodeId = way.refs[i]
				nearestNodeRefIndex = i
			}
		})
		return {
			refIndex: nearestNodeRefIndex,
			nodeId: nearestNodeId,
		}
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
		const bbox = this.osm.ways.getNodeBbox({ index: wayIndex })
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

	applyChanges(newId?: string) {
		return applyChangesetToOsm(this, newId)
	}

	/**
	 * Generate OSC (OSM Change) XML format string from this changeset.
	 * Returns an `<osmChange>` document containing create, modify, and delete sections.
	 */
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

		for (const relation of Object.values(this.relationChanges)) {
			const tags = relation.entity.tags
				? osmTagsToOscTags(relation.entity.tags)
				: ""
			const members = relation.entity.members
				.map(
					(member) =>
						`<member type="${member.type}" ref="${member.ref}"${member.role ? ` role="${member.role}"` : ""} />`,
				)
				.join("")
			if (relation.changeType === "create") {
				create += `<relation id="${relation.entity.id}">${tags}${members}</relation>`
			} else if (relation.changeType === "modify") {
				modify += `<relation id="${relation.entity.id}">${tags}${members}</relation>`
			} else if (relation.changeType === "delete") {
				del += `<relation id="${relation.entity.id}" />`
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
