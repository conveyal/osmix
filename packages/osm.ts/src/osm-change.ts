import type { Osm } from "./osm"
import type { OsmChange } from "./types"
import { isNodeEqual, isRelationEqual, isWayEqual } from "./utils"

/**
 * Generate a list of changes to merge the patchOsm into the baseOsm.
 *
 * @param baseOsm - The OSM data to merge into.
 * @param patchOsm - The OSM data to merge from.
 * @returns The changes to apply to the baseOsm.
 */
export function generateOsmChanges(baseOsm: Osm, patchOsm: Osm): OsmChange[] {
	const changes: OsmChange[] = []

	for (const [id, entity] of patchOsm.nodes.entries()) {
		const existingNode = baseOsm.nodes.get(id)
		if (existingNode && isNodeEqual(existingNode, entity)) continue

		changes.push({
			changeType: existingNode ? "modify" : "create",
			entity,
		})
	}

	for (const [id, entity] of patchOsm.ways.entries()) {
		const existingWay = baseOsm.ways.get(id)
		if (existingWay && isWayEqual(existingWay, entity)) continue

		changes.push({
			changeType: existingWay ? "modify" : "create",
			entity,
		})
	}

	for (const [id, entity] of patchOsm.relations.entries()) {
		const existingRelation = baseOsm.relations.get(id)
		if (existingRelation && isRelationEqual(existingRelation, entity)) continue

		changes.push({
			changeType: existingRelation ? "modify" : "create",
			entity,
		})
	}

	return changes
}
