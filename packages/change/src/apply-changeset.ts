import { Osm } from "@osmix/core"
import type { OsmChangeset } from "./changeset"

/**
 * Apply a changeset to an Osm index, generating a new Osm index. Usually done on a changeset made from the base osm index.
 */
export function applyChangesetToOsm(
	changeset: OsmChangeset,
	newOsmId?: string,
) {
	const baseOsm = changeset.osm
	const osm = new Osm({
		id: newOsmId ?? baseOsm.id,
		header: baseOsm.header,
	})

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

	// Build spatial indexes
	osm.buildSpatialIndexes()

	return osm
}
