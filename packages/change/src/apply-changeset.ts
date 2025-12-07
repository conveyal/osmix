/**
 * Changeset application utilities.
 *
 * Applies accumulated changes from an OsmChangeset to produce a new Osm index
 * with all creates, modifies, and deletes applied immutably.
 *
 * @module
 */

import { Osm } from "@osmix/core"
import type { OsmChangeset } from "./changeset"

/**
 * Apply a changeset to an Osm index, producing a new Osm index.
 *
 * Creates a fresh Osm instance and applies all changes from the changeset:
 * - Entities marked for deletion are excluded
 * - Modified entities use the updated version from the changeset
 * - Created entities are added to the new index
 *
 * The original base Osm remains immutable. After application, the new Osm
 * has built ID, tag, and spatial indexes.
 *
 * @param changeset - The changeset to apply (contains reference to base Osm).
 * @param newOsmId - Optional ID for the new Osm index (defaults to base ID).
 * @returns A new Osm index with all changes applied.
 * @throws If changeset contains invalid change sequences (e.g., create for existing entity).
 *
 * @example
 * ```ts
 * const changeset = new OsmChangeset(baseOsm)
 * changeset.deduplicateNodes(baseOsm.nodes)
 * const newOsm = applyChangesetToOsm(changeset)
 * ```
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
