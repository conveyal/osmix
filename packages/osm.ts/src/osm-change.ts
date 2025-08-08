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

	for (const entity of patchOsm.nodes) {
		const existingNode = baseOsm.nodes.get({ id: entity.id })
		if (existingNode && isNodeEqual(existingNode, entity)) continue

		changes.push({
			changeType: existingNode ? "modify" : "create",
			entity,
		})
	}

	for (const way of patchOsm.ways) {
		const existingWay = baseOsm.ways.get({ id: way.id })
		if (existingWay && isWayEqual(existingWay, way)) continue

		changes.push({
			changeType: existingWay ? "modify" : "create",
			entity: way,
		})
	}

	for (const relation of patchOsm.relations) {
		const existingRelation = baseOsm.relations.get({ id: relation.id })
		if (existingRelation && isRelationEqual(existingRelation, relation))
			continue

		changes.push({
			changeType: existingRelation ? "modify" : "create",
			entity: relation,
		})
	}

	return changes
}
