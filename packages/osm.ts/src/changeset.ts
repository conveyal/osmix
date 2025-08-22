import { lineIntersect } from "@turf/turf"
import { Osm } from "./osm"
import type {
	LonLat,
	OsmChange,
	OsmEntity,
	OsmEntityType,
	OsmEntityTypeMap,
	OsmNode,
	OsmTags,
	OsmWay,
} from "./types"
import { entityPropertiesEqual, getEntityType, osmTagsToOscTags } from "./utils"

export type OsmMergeOptions = {
	directMerge: boolean
	deduplicateNodes: boolean
	createIntersections: boolean
}

export type OsmChangesStats = {
	deduplicatedNodes: number
	deduplicatedNodesReplaced: number
	intersectionPointsFound: number
}

export type OsmChanges = {
	nodes: Record<number, OsmChange<OsmEntityTypeMap["node"]>>
	ways: Record<number, OsmChange<OsmEntityTypeMap["way"]>>
	relations: Record<number, OsmChange<OsmEntityTypeMap["relation"]>>
	stats: OsmChangesStats
}

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
		intersectionPointsFound: 0,
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

	create(entity: OsmEntity) {
		this.changes(getEntityType(entity))[entity.id] = {
			changeType: "create",
			entity,
		}
	}

	createNode(ll: LonLat, tags?: OsmTags) {
		const node: OsmNode = {
			id: this.nextNodeId(),
			lon: ll.lon,
			lat: ll.lat,
			tags,
		}
		this.changes("node")[node.id] = {
			changeType: "create",
			entity: node,
		}
		return node
	}

	/**
	 * Add or update an `OsmChange` for a given entity. There must be an existing entity in the base OSM, otherwise a `create` change
	 * should have been added instead. If a
	 */
	modify<T extends OsmEntityType>(
		type: T,
		id: number,
		modify: (entity: OsmEntityTypeMap[T]) => OsmEntityTypeMap[T],
	): void {
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
		}
	}

	delete(entity: OsmEntity) {
		this.changes(getEntityType(entity))[entity.id] = {
			changeType: "delete",
			entity,
		}
	}

	deduplicateOverlappingNodes(node: OsmNode): number {
		const existingNodes = this.osm.nodes.findNeighborsWithin(node, 0)
		const existingNode = existingNodes[0]
		if (existingNode == null) return -1
		this.stats.deduplicatedNodes++
		this.delete(existingNode)

		let deduplicatedNodesReplaced = 0
		// Find ways that contain the replaced node and modify them.
		for (const wayIndex of this.osm.ways.neighbors(
			node.lon,
			node.lat,
			10,
			0.01,
		)) {
			const wayRefs = this.osm.ways.getRefIds(wayIndex)
			if (wayRefs.includes(existingNode.id)) {
				const way = this.osm.ways.getByIndex(wayIndex)
				deduplicatedNodesReplaced++
				this.modify("way", way.id, (way) => ({
					...way,
					refs: way.refs.map((ref) =>
						ref === existingNode.id ? node.id : ref,
					),
				}))
			}
		}

		// Find relations that contain the replaced node and modify them.
		for (const relation of this.osm.relations) {
			for (const member of relation.members) {
				if (member.type === "node" && member.ref === existingNode.id) {
					deduplicatedNodesReplaced++
					this.modify("relation", relation.id, (relation) => ({
						...relation,
						members: relation.members.map((member) =>
							member.ref === existingNode.id
								? { ...member, ref: node.id }
								: member,
						),
					}))
				}
			}
		}
		this.stats.deduplicatedNodesReplaced += deduplicatedNodesReplaced
		return deduplicatedNodesReplaced
	}

	// Find intersecting way IDs and points for this way
	handleIntersectingWays(patchWay: OsmWay, patch: Osm) {
		const patchWayIndex = patch.ways.ids.getIndexFromId(patchWay.id)
		const intersectingWayIndexes = this.osm.ways.intersects(
			patch.ways.getBbox({ index: patchWayIndex }),
		)

		for (const baseWayIndex of intersectingWayIndexes) {
			const baseWay = this.osm.ways.getByIndex(baseWayIndex)
			if (
				baseWay.id !== patchWay.id &&
				waysShouldConnect(patchWay.tags, baseWay.tags)
			) {
				const intersectingPoints: LonLat[] = lineIntersect(
					patch.ways.getLineString({ index: patchWayIndex }, patch.nodes),
					this.osm.ways.getLineString({ index: baseWayIndex }, this.osm.nodes),
				).features.map((f) => ({
					lon: f.geometry.coordinates[0],
					lat: f.geometry.coordinates[1],
				}))

				for (const ll of intersectingPoints) {
					this.stats.intersectionPointsFound++
					const onBase = this.osm.ways.nearestPointOnLine(
						baseWayIndex,
						ll,
						this.osm.nodes,
					)
					const closestBaseNodeId = baseWay.refs.at(onBase.properties.index)
					const baseNode =
						closestBaseNodeId && onBase.properties.dist < 0.001 // within 1 meter
							? this.osm.nodes.getById(closestBaseNodeId)
							: null

					const onPatch = patch.ways.nearestPointOnLine(
						patchWayIndex,
						ll,
						patch.nodes,
					)
					const closestPatchNodeId = patchWay.refs.at(onPatch.properties.index)
					const patchNode =
						closestPatchNodeId && onPatch.properties.dist < 0.001 // within 1 meter
							? patch.nodes.getById(closestPatchNodeId)
							: null

					// If patch node and existing node both exist here they should have been deduplicated. Use the patch node.
					const intersectionNode = patchNode ?? baseNode ?? this.createNode(ll)

					if (baseNode == null) {
						this.modify("way", baseWay.id, (way) => {
							return {
								...way,
								refs: way.refs.toSpliced(
									onBase.properties.index,
									0,
									intersectionNode.id,
								),
							}
						})
					}

					if (patchNode == null) {
						this.modify("way", patchWay.id, (way) => {
							return {
								...way,
								refs: way.refs.toSpliced(
									onPatch.properties.index,
									0,
									intersectionNode.id,
								),
							}
						})
					}

					this.modify("node", intersectionNode.id, (node) => ({
						...node,
						tags: {
							...node.tags,
							crossing: "yes",
						},
					}))
				}
			}
		}
	}

	generateDirectChanges(patch: Osm) {
		if (this.osm.nodes.size === 0 || patch.nodes.size === 0) {
			throw Error("No nodes in base or patch")
		}

		// Reset the current node ID to the highest node ID in the base or patch
		this.currentNodeId = Math.max(
			this.osm.nodes.ids.at(-1),
			patch.nodes.ids.at(-1),
		)

		// First, create or modify all nodes, ways, and relations in the patch
		for (const node of patch.nodes) {
			const existingNode = this.osm.nodes.getById(node.id)
			if (existingNode == null) {
				this.nodeChanges[node.id] = {
					changeType: "create",
					entity: node,
				}
			} else if (!entityPropertiesEqual(existingNode, node)) {
				// Replace the existing entity with the patch entity
				this.nodeChanges[node.id] = {
					changeType: "modify",
					entity: node,
				}
			}
		}

		for (const way of patch.ways) {
			const existingWay = this.osm.ways.getById(way.id)
			if (existingWay == null) {
				this.wayChanges[way.id] = {
					changeType: "create",
					entity: way,
				}
			} else if (!entityPropertiesEqual(existingWay, way)) {
				// Replace the existing entity with the patch entity
				this.wayChanges[way.id] = {
					changeType: "modify",
					entity: way,
				}
			}
		}

		for (const relation of patch.relations) {
			const existingRelation = this.osm.relations.getById(relation.id)
			if (existingRelation == null) {
				this.relationChanges[relation.id] = {
					changeType: "create",
					entity: relation,
				}
			} else if (!entityPropertiesEqual(existingRelation, relation)) {
				// Replace the existing entity with the patch entity
				this.relationChanges[relation.id] = {
					changeType: "modify",
					entity: relation,
				}
			}
		}
	}

	deduplicateNodes(patch: Osm) {
		for (const node of patch.nodes) {
			this.deduplicateOverlappingNodes(node)
		}
	}

	createIntersections(patch: Osm) {
		for (const way of patch.ways) {
			this.handleIntersectingWays(way, patch)
		}
	}

	generateFullChangeset(
		patch: Osm,
		{ directMerge, deduplicateNodes, createIntersections }: OsmMergeOptions = {
			directMerge: true,
			deduplicateNodes: true,
			createIntersections: true,
		},
	) {
		if (directMerge) {
			this.generateDirectChanges(patch)
		}

		if (deduplicateNodes) {
			this.deduplicateNodes(patch)
		}

		if (createIntersections) {
			this.createIntersections(patch)
		}
	}

	applyChanges(newId?: string) {
		return applyChangesetToOsm(newId ?? `${this.osm.id}-merged`, this.osm, this)
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

/**
 * Apply a changeset to an Osm index, generating a new Osm index. Usually done on a changeset made from the base osm index.
 */
export function applyChangesetToOsm(
	newId: string,
	baseOsm: Osm,
	changeset: OsmChangeset,
) {
	const osm = new Osm(newId, baseOsm.header)

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

/**
 * Determine if two ways should be connected based on their tags
 */
function waysShouldConnect(tagsA?: OsmTags, tagsB?: OsmTags) {
	const a = tagsA || {}
	const b = tagsB || {}
	const isHighway = (t: OsmTags) => t.highway != null
	const isFootish = (t: OsmTags) =>
		["footway", "path", "cycleway", "bridleway", "steps"].includes(
			String(t.highway),
		)
	const isPolygonish = (t: OsmTags) => !!(t.building || t.landuse || t.natural)
	const isSeparated = !!(a.bridge || a.tunnel || b.bridge || b.tunnel)
	const diffLayer = (a.layer ?? "0") !== (b.layer ?? "0")

	if (isPolygonish(a) || isPolygonish(b)) return false
	if (isSeparated || diffLayer) return false

	if (isHighway(a) && isHighway(b)) return true
	if (isHighway(a) && isFootish(b)) return true
	if (isHighway(b) && isFootish(a)) return true

	return false
}
