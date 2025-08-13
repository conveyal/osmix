import { lineIntersect } from "@turf/turf"
import { Osm } from "./osm"
import type {
	LonLat,
	OsmChange,
	OsmEntity,
	OsmEntityType,
	OsmEntityTypeMap,
	OsmNode,
	OsmRelation,
	OsmTags,
	OsmWay,
} from "./types"
import {
	entityPropertiesEqual,
	getEntityType,
	isNode,
	isRelation,
	isWay,
} from "./utils"

export default class Changeset {
	nodeChanges = new Map<number, OsmChange<OsmEntityTypeMap["node"]>>()
	wayChanges = new Map<number, OsmChange<OsmEntityTypeMap["way"]>>()
	relationChanges = new Map<number, OsmChange<OsmEntityTypeMap["relation"]>>()

	osm: Osm

	// Next node ID
	currentNodeId: number

	stats = {
		deduplicatedNodes: 0,
		deduplicatedNodesReplaced: 0,
		intersectionPointsFound: 0,
	}

	constructor(base: Osm) {
		this.osm = base
		this.currentNodeId = base.nodes.ids.at(-1)
	}

	changes<T extends OsmEntityType>(
		type: T,
	): Map<number, OsmChange<OsmEntityTypeMap[T]>> {
		switch (type) {
			case "node":
				return this.nodeChanges as Map<number, OsmChange<OsmEntityTypeMap[T]>>
			case "way":
				return this.wayChanges as Map<number, OsmChange<OsmEntityTypeMap[T]>>
			case "relation":
				return this.relationChanges as Map<
					number,
					OsmChange<OsmEntityTypeMap[T]>
				>
		}
	}

	nextNodeId() {
		return ++this.currentNodeId
	}

	create(entity: OsmEntity) {
		this.changes(getEntityType(entity)).set(entity.id, {
			changeType: "create",
			entity,
		})
	}

	createNode(ll: LonLat, tags?: OsmTags) {
		const node: OsmNode = {
			id: this.nextNodeId(),
			lon: ll.lon,
			lat: ll.lat,
			tags,
		}
		this.changes("node").set(node.id, {
			changeType: "create",
			entity: node,
		})
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
		const change = changes.get(id)
		const changeEntity = change
			? (change.entity as OsmEntityTypeMap[T])
			: undefined
		const existingEntity = changeEntity ?? this.osm.get(type, id)
		if (existingEntity == null) throw Error("Entity not found")
		changes.set(id, {
			changeType: change?.changeType ?? "modify",
			entity: modify(existingEntity),
		})
	}

	delete(entity: OsmEntity) {
		this.changes(getEntityType(entity)).set(entity.id, {
			changeType: "delete",
			entity,
		})
	}

	deduplicateOverlappingNodes(node: OsmNode) {
		const existingNodes = this.osm.nodes.findNeighborsWithin(node, 0)
		const existingNode = existingNodes[0]
		if (existingNode == null) return
		this.stats.deduplicatedNodes++
		this.delete(existingNode)

		// Find ways that contain the replaced node and modify them.
		for (const wayIndex of this.osm.ways.neighbors(node.lon, node.lat, 10)) {
			const way = this.osm.ways.getByIndex(wayIndex)
			if (way.refs.includes(existingNode.id)) {
				this.stats.deduplicatedNodesReplaced++
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
					this.stats.deduplicatedNodesReplaced++
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
					patch.ways.getLineString({ index: patchWayIndex }),
					this.osm.ways.getLineString({ index: baseWayIndex }),
				).features.map((f) => ({
					lon: f.geometry.coordinates[0],
					lat: f.geometry.coordinates[1],
				}))

				for (const ll of intersectingPoints) {
					this.stats.intersectionPointsFound++
					const onBase = this.osm.ways.nearestPointOnLine(baseWayIndex, ll)
					const closestBaseNodeId = baseWay.refs.at(onBase.properties.index)
					const baseNode =
						closestBaseNodeId && onBase.properties.dist < 0.001 // within 1 meter
							? this.osm.nodes.getById(closestBaseNodeId)
							: null

					const onPatch = patch.ways.nearestPointOnLine(patchWayIndex, ll)
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

	generateFullChangeset(patch: Osm) {
		// Reset the current node ID to the highest node ID in the base or patch
		this.currentNodeId = Math.max(
			this.osm.nodes.ids.at(-1),
			patch.nodes.ids.at(-1),
		)

		// First, create or modify all entities in the patch
		for (const entity of patch) {
			const type = getEntityType(entity)
			const existingEntity = this.osm.get(type, entity.id)
			if (existingEntity == null) {
				this.create(entity)
			} else if (!entityPropertiesEqual(existingEntity, entity)) {
				// Replace the existing entity with the patch entity
				this.changes(type).set(entity.id, {
					changeType: "modify",
					entity,
				})
			}
		}

		// Then de-duplicate overlapping nodes
		for (const node of patch.nodes) {
			this.deduplicateOverlappingNodes(node)
		}

		// Then handle intersecting ways
		for (const way of patch.ways) {
			this.handleIntersectingWays(way, patch)
		}
	}

	applyChanges() {
		const osm = new Osm(this.osm.header)

		// Add nodes from base, modifying and deleting as needed
		for (const node of this.osm.nodes) {
			const change = this.nodeChanges.get(node.id)
			if (change) {
				console.error(change)
				// Remove the change from the changeset so we don't apply it twice
				this.nodeChanges.delete(node.id)
				if (change.changeType === "delete") continue // Don't add deleted nodes
				if (change.changeType === "create")
					throw Error("Changeset contains create changes for existing entities")
			}
			osm.nodes.addNode(change?.entity ?? node)
		}

		// All remaining node changes should be create
		// Add nodes from patch
		for (const change of this.nodeChanges.values()) {
			if (change.changeType !== "create") {
				throw Error("Changeset still contains node changes in incorrect stage.")
			}
			if (change.entity.id === 2135545) {
				console.error(change)
			}
			osm.nodes.addNode(change.entity)
		}

		// All nodes should be added now, finish the node index
		osm.nodes.finish()

		// Add ways from base, modifying and deleting as needed
		for (const way of this.osm.ways) {
			const change = this.wayChanges.get(way.id)
			if (change) {
				// Remove the change from the changeset so we don't apply it twice
				this.wayChanges.delete(way.id)
				if (change.changeType === "delete") continue // Don't add deleted ways
				if (change.changeType === "create") {
					throw Error("Changeset contains create changes for existing entities")
				}
			}
			osm.ways.addWay(change?.entity ?? way)
		}

		// All remaining way changes should be create
		// Add ways from patch
		for (const change of this.wayChanges.values()) {
			if (change.changeType !== "create")
				throw Error("Changeset still contains way changes in incorrect stage.")
			osm.ways.addWay(change.entity)
		}

		// All ways should be added now, finish the way index
		osm.ways.finish()

		// Add relations from base, modifying and deleting as needed
		for (const relation of this.osm.relations) {
			const change = this.relationChanges.get(relation.id)
			if (change) {
				// Remove the change from the changeset so we don't apply it twice
				this.relationChanges.delete(relation.id)
				if (change.changeType === "delete") continue // Don't add deleted relations
				if (change.changeType === "create") {
					throw Error("Changeset contains create changes for existing entities")
				}
			}
			osm.relations.addRelation(change?.entity ?? relation)
		}

		// Add relations from patch
		for (const change of this.relationChanges.values()) {
			if (change.changeType !== "create")
				throw Error(
					"Changeset still contains relation changes in incorrect stage.",
				)
			osm.relations.addRelation(change.entity)
		}

		// All relations should be added now, finish the relation index
		osm.relations.finish()

		// Everything should be added now, finish the osm
		osm.finish()

		return osm
	}
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
