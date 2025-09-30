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
import { distance } from "@turf/distance"
import { lineIntersect } from "@turf/line-intersect"
import { dequal } from "dequal" // dequal/lite does not work with `TypedArray`s
import { Osm } from "./osm"
import type { OsmChange, OsmEntityRef } from "./types"
import {
	cleanCoords,
	isWayIntersectionCandidate,
	osmTagsToOscTags,
	removeDuplicateAdjacentOsmWayRefs,
	waysShouldConnect,
} from "./utils"
import type { Ways } from "./ways"

export interface OsmMergeOptions {
	directMerge: boolean
	deduplicateNodes: boolean
	createIntersections: boolean
}

export type OsmChangesStats = {
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
	stats: OsmChangesStats
}

/**
 * Each step is optimized to minimize the retrieval of the full entity data.
 */
export default class OsmChangeset {
	nodeChanges: Record<number, OsmChange<OsmEntityTypeMap["node"]>> = {}
	wayChanges: Record<number, OsmChange<OsmEntityTypeMap["way"]>> = {}
	relationChanges: Record<number, OsmChange<OsmEntityTypeMap["relation"]>> = {}

	osm: Osm

	// Next node ID
	currentNodeId: number

	stats: OsmChangesStats = {
		deduplicatedNodes: 0,
		deduplicatedNodesReplaced: 0,
		deduplicatedWays: 0,
		intersectionPointsFound: 0,
		intersectionNodesCreated: 0,
	}

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

	deduplicateOverlappingNodes(
		nodeIndex: number,
		osm: Osm,
		idPairs: IdPairs,
	): number {
		const nodeId = osm.nodes.ids.at(nodeIndex)
		if (nodeId == null) return 0

		// Has this node already been deduplicated? (scheduled for deletion)
		if (this.nodeChanges[nodeId]?.changeType === "delete") return 0

		const ll = osm.nodes.getNodeLonLat({ index: nodeIndex })
		const existingNodes = osm.nodes.withinRadius(ll[0], ll[1], 0)
		const existingNodeIds = existingNodes
			.map((index) => ({ id: this.osm.nodes.ids.at(index), index }))
			.filter((n) => n.id !== nodeId && !idPairs.has(n.id, nodeId))
		if (existingNodeIds.length === 0) return 0

		// Found a duplicate, load the full node
		let deduplicatedNodesReplaced = 0
		for (const { index: existingNodeIndex } of existingNodeIds) {
			const existingNode = osm.nodes.getByIndex(existingNodeIndex)
			if (existingNode == null) continue

			// Add this pair to the deduped ID pairs
			idPairs.add(existingNode.id, nodeId)

			const patchNode = osm.nodes.getByIndex(nodeIndex)

			const neigborWayIndexes = this.osm.ways.neighbors(
				patchNode.lon,
				patchNode.lat,
				20,
				0,
			)

			// Find ways that contain the replaced node
			const candidateWays: OsmWay[] = []
			for (const wayIndex of neigborWayIndexes) {
				const wayRefs = osm.ways.getRefIds(wayIndex)
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
			this.stats.deduplicatedNodes++
			this.delete(existingNode, [
				{ type: "node", id: patchNode.id, osmId: osm.id },
			])
		}

		// Increment the total number of nodes replaced
		this.stats.deduplicatedNodesReplaced += deduplicatedNodesReplaced
		return deduplicatedNodesReplaced
	}

	/**
	 * TODO: replace refs in relations with new way
	 */
	deduplicateWay(wayIndex: number, osm: Osm, dedupedIdPairs: IdPairs) {
		const way = osm.ways.getByIndex(wayIndex)
		const wayCoords = osm.ways.getCoordinates(wayIndex, osm.nodes)

		// Look for duplicate ways in the patch
		const closeWayIndexes = osm.ways.intersects(osm.ways.getBbox(way))
		const wayVersion = getEntityVersion(way)
		const wayTagCount = Object.keys(way.tags ?? {}).length
		const candidateDuplicateWays: OsmWay[] = closeWayIndexes
			.map((index) => {
				const otherWay = osm.ways.getByIndex(index)
				if (otherWay.id === way.id) return null

				// Has this pair been deduped or checked already?
				if (dedupedIdPairs.has(way.id, otherWay.id)) return null
				dedupedIdPairs.add(way.id, otherWay.id)

				// Check if all way properties other than the ID are equal
				if (isWayEqual(way, otherWay)) return otherWay

				// Check geometry
				const coords = osm.ways.getCoordinates(index, osm.nodes)
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
			way,
			candidateDuplicateWays.map((way) => ({
				type: "way",
				id: way.id,
				osmId: osm.id,
			})),
		)
		this.stats.deduplicatedWays++

		return candidateDuplicateWays.length
	}

	*deduplicateWays(osm?: Osm) {
		const dedupedIdPairs = new IdPairs()
		for (let wayIndex = 0; wayIndex < (osm ?? this.osm).ways.size; wayIndex++) {
			yield this.deduplicateWay(wayIndex, osm ?? this.osm, dedupedIdPairs)
		}
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
			const nodeDistance = distance(wayCoords[i], point, { units: "meters" })
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
			for (const point of intersectingPoints.features) {
				const pt = point.geometry.coordinates as [number, number]
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

		this.stats.intersectionPointsFound += intersectionsFound
		this.stats.intersectionNodesCreated += intersectionsCreated

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
	generateDirectChanges(patch: Osm) {
		// Reset the current node ID to the highest node ID in the base or patch
		this.currentNodeId = Math.max(
			this.osm.nodes.ids.at(-1),
			patch.nodes.ids.at(-1),
		)

		// First, create or modify all ways in the patch
		for (let patchIndex = 0; patchIndex < patch.ways.size; patchIndex++) {
			const way = patch.ways.getByIndex(patchIndex)
			if (this.osm.ways.ids.has(way.id)) {
				const existingWay = this.osm.ways.getById(way.id)
				if (existingWay && !entityPropertiesEqual(existingWay, way)) {
					// Replace the existing entity with the patch entity
					this.modify("way", way.id, (_existingWay) =>
						removeDuplicateAdjacentOsmWayRefs(way),
					)
				}
			} else {
				const patchWayCoords = patch.ways.getCoordinates(
					patchIndex,
					patch.nodes,
				)

				// Look for duplicate ways in the patch
				const closePatchWayIndexes = patch.ways.intersects(
					patch.ways.getBbox(way),
				)
				const patchWayVersion = getEntityVersion(way)
				const patchWayTagCount = Object.keys(way.tags ?? {}).length
				const validPatchWays: OsmWay[] = closePatchWayIndexes
					.map((index) => {
						const otherWay = patch.ways.getByIndex(index)
						if (otherWay.id === way.id) return null
						// Check if all way properties other than the ID are equal
						if (isWayEqual(way, otherWay)) return otherWay
						const otherWayVersion = getEntityVersion(otherWay)
						if (otherWayVersion < patchWayVersion) return null
						const coords = patch.ways.getCoordinates(index, patch.nodes)
						if (!dequal(patchWayCoords, coords)) return null
						if (otherWayVersion > patchWayVersion) return otherWay
						// Ways are geometrically equal, with same version. Keep the way with more tags
						const tagCount = Object.keys(otherWay.tags ?? {}).length
						return tagCount >= patchWayTagCount ? otherWay : null
					})
					.filter((way) => way !== null)
				// Newer version of this way exists, skip creating it
				if (validPatchWays.length > 0) {
					this.stats.deduplicatedWays++
					continue
				}

				// Create the way
				this.create(removeDuplicateAdjacentOsmWayRefs(way), patch.id)

				// Check for duplicate ways
				const closeWayIndexes = this.osm.ways.intersects(
					patch.ways.getBbox(way),
				)

				const duplicateWayIndexes: OsmWay[] = []
				for (const closeWayIndex of closeWayIndexes) {
					const closeWayCoords = this.osm.ways.getCoordinates(
						closeWayIndex,
						this.osm.nodes,
					)
					if (dequal(patchWayCoords, closeWayCoords)) {
						duplicateWayIndexes.push(this.osm.ways.getByIndex(closeWayIndex))
					}
				}

				if (duplicateWayIndexes.length === 0) continue
				if (duplicateWayIndexes.length > 1)
					throw Error("MULTIPLE DUPLICATE WAYS FOUND")

				const duplicateWay = duplicateWayIndexes[0]
				// Already scheduled for deletion? Continue
				if (this.wayChanges[duplicateWay.id]?.changeType === "delete") continue
				// TODO: Should we merge the tags from this way?
				this.delete(duplicateWay, [
					{ type: "way", id: way.id, osmId: patch.id },
				])
				this.stats.deduplicatedWays++
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

				// Check for duplicate nodes
				const duplicateNodes = this.osm.nodes.withinRadius(
					node.lon,
					node.lat,
					0,
				)
				if (duplicateNodes.length === 0) continue
				if (duplicateNodes.length > 1)
					throw Error("MULTIPLE DUPLICATE NODES FOUND")

				// Set duplicate node to be deleted
				const duplicateNode = this.osm.nodes.getByIndex(duplicateNodes[0])

				// Already scheduled for deletion? Continue
				if (this.nodeChanges[duplicateNode.id]?.changeType === "delete")
					continue

				// Schedule for deletion
				this.delete(duplicateNode, [
					{ type: "node", id: node.id, osmId: patch.id },
				])
				this.stats.deduplicatedNodes++

				// Find ways that contain the existing node
				const wayIndexes = this.osm.ways.neighbors(
					node.lon,
					node.lat,
					Number.POSITIVE_INFINITY,
					0, // If the node is within the bounding box of a way, it will be found
				)
				if (wayIndexes.length === 0)
					throw Error("NO WAYS FOUND FOR DUPLICATE NODE")

				for (const wayIndex of wayIndexes) {
					const way = this.osm.ways.getByIndex(wayIndex)
					if (!way.refs.includes(duplicateNode.id)) continue

					this.stats.deduplicatedNodesReplaced++
					this.modify("way", way.id, (way) => ({
						...way,
						refs: way.refs.map((ref) =>
							ref === duplicateNode.id ? node.id : ref,
						),
					}))
				}

				// TODO replace refs in relations
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

	*deduplicateNodes(osm?: Osm) {
		const dedupedIdPairs = new IdPairs()
		for (
			let nodeIndex = 0;
			nodeIndex < (osm ?? this.osm).nodes.size;
			nodeIndex++
		) {
			yield this.deduplicateOverlappingNodes(
				nodeIndex,
				osm ?? this.osm,
				dedupedIdPairs,
			)
		}
	}

	/**
	 *
	 * @param patch
	 */
	*generateIntersectionsForWays(ways: Ways) {
		const wayIdPairs = new IdPairs()
		for (const way of ways) {
			if (!isWayIntersectionCandidate(way)) continue
			if (!this.osm.ways.ids.has(way.id)) continue
			yield this.createIntersectionsForWay(way, wayIdPairs)
		}
	}

	createIntersectionsForWays(ways: Ways) {
		for (const _ of this.generateIntersectionsForWays(ways)) {
			// Do nothing
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
			<osmChange version="0.6" generator="osm.ts">
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

function waysIntersect(wayA: [number, number][], wayB: [number, number][]) {
	return lineIntersect(
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
	)
}

/**
 * Apply a changeset to an Osm index, generating a new Osm index. Usually done on a changeset made from the base osm index.
 */
export function applyChangesetToOsm(changeset: OsmChangeset, newId?: string) {
	const baseOsm = changeset.osm
	const osm = new Osm(newId ?? `${baseOsm.id}-merged`, baseOsm.header)

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
	osm.finish()

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
