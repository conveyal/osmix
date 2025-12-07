/**
 * Geographic extraction from OSM indexes.
 *
 * Creates subsets of OSM data within bounding boxes using various strategies
 * that control how ways and relations at the boundary are handled.
 *
 * @module
 */

import { Osm } from "@osmix/core"
import {
	logProgress,
	type ProgressEvent,
	progressEvent,
} from "@osmix/shared/progress"
import { resolveRelationMembers } from "@osmix/shared/relation-kind"
import type { GeoBbox2D, OsmRelation } from "@osmix/shared/types"
import { isMultipolygonRelation } from "@osmix/shared/utils"

/**
 * Strategy for handling entities at extract boundaries.
 * - `"simple"`: Strict spatial cut, may have incomplete geometries.
 * - `"complete_ways"`: Preserves complete way geometry, adds nodes outside bbox.
 * - `"smart"`: Like complete_ways, plus fully resolves multipolygon relations.
 */
export type ExtractStrategy = "simple" | "complete_ways" | "smart"

/**
 * Create a geographic extract from an existing Osm instance within a bounding box.
 *
 * Strategy "simple":
 * 1. Selects all nodes inside the bbox.
 * 2. Selects ways with at least one node inside the bbox, filtering refs to only include nodes inside the bbox.
 * 3. Selects relations with at least one member inside the bbox, filtering members to only include nodes and ways inside the bbox.
 *
 * Strategy "complete_ways":
 * 1. Selects all nodes inside the bbox.
 * 2. Selects ways with at least one node inside the bbox, adding missing way nodes from outside the bbox. All ways will be reference complete.
 * 3. Selects relations with at least one member inside the bbox leaving out any members that are not inside the bbox. Relations are not reference complete.
 *
 * Strategy "smart":
 * 1 & 2. Same as "complete_ways".
 * 3. Selects relations with at least one member inside the bbox, adding missing relation members from outside the bbox. Relations are reference complete.
 *
 * The "complete_ways" strategy preserves way geometry integrity but includes entities outside the bbox.
 * The "simple" strategy creates a strict spatial cut but may result in incomplete geometries.
 * Both strategies handle nested relations by resolving all descendant members.
 *
 * See https://osmcode.org/osmium-tool/manual.html#creating-geographic-extracts for more details.
 */
export function createExtract(
	osm: Osm,
	bbox: GeoBbox2D,
	strategy: ExtractStrategy = "complete_ways",
	onProgress: (progress: ProgressEvent) => void = logProgress,
): Osm {
	if (!osm.isReady()) throw Error("Osm is not ready for extraction.")

	onProgress(
		progressEvent(
			`Creating extract ${osm.id} with strategy=${strategy} in bbox ${bbox.join(", ")}...`,
		),
	)
	const [minLon, minLat, maxLon, maxLat] = bbox
	const extracted = new Osm({
		id: osm.id,
		header: {
			...osm.header,
			bbox: {
				left: minLon,
				bottom: minLat,
				right: maxLon,
				top: maxLat,
			},
		},
	})

	const nodeIds = new Set<number>()
	const wayIds = new Set<number>()
	const relationIds = new Set<number>()
	const addNodeIfMissing = (id: number) => {
		if (nodeIds.has(id)) return
		const node = osm.nodes.getById(id)
		if (!node) throw Error(`Node ${id} not found`)
		extracted.nodes.addNode(node)
		nodeIds.add(id)
	}
	const addWayIfMissing = (id: number) => {
		if (wayIds.has(id)) return
		const way = osm.ways.getById(id)
		if (!way) throw Error(`Way ${id} not found`)
		for (const ref of way.refs) addNodeIfMissing(ref)
		extracted.ways.addWay(way)
		wayIds.add(id)
	}
	const addRelationIfMissing = (relation: OsmRelation): void => {
		if (relationIds.has(relation.id)) return
		relationIds.add(relation.id)
		for (const member of relation.members) {
			if (member.type === "node") addNodeIfMissing(member.ref)
			if (member.type === "way") addWayIfMissing(member.ref)
			if (member.type === "relation") {
				const nestedRelation = osm.relations.getById(member.ref)
				if (nestedRelation) addRelationIfMissing(nestedRelation)
			}
		}
		extracted.relations.addRelation(relation)
	}

	onProgress(progressEvent("Extracting nodes..."))
	for (const nodeIndex of osm.nodes.findIndexesWithinBbox(bbox)) {
		const node = osm.nodes.getByIndex(nodeIndex)
		extracted.nodes.addNode(node)
		nodeIds.add(node.id)
	}

	onProgress(progressEvent("Extracting ways..."))
	for (const way of osm.ways.sorted()) {
		if (way.refs.some((ref) => nodeIds.has(ref))) {
			wayIds.add(way.id)
			if (strategy === "complete_ways" || strategy === "smart") {
				for (const ref of way.refs) addNodeIfMissing(ref)
				extracted.ways.addWay(way)
			} else if (strategy === "simple") {
				extracted.ways.addWay({
					...way,
					refs: way.refs.filter((ref) => nodeIds.has(ref)),
				})
			}
		}
	}

	onProgress(progressEvent("Extracting relations..."))
	for (const relation of osm.relations.sorted()) {
		// Resolve nested relations to get all descendant nodes and ways
		const resolved = resolveRelationMembers(
			relation,
			(relId) => osm.relations.getById(relId),
			10, // max depth
		)

		// Check if relation has any members that intersect the bbox
		const hasIntersectingMembers =
			resolved.nodes.some((id) => nodeIds.has(id)) ||
			resolved.ways.some((id) => wayIds.has(id))

		if (hasIntersectingMembers) {
			if (isMultipolygonRelation(relation) && strategy === "smart") {
				// Add relation and recursively add direct members even if they're outside the bbox
				addRelationIfMissing(relation)
			} else {
				// Otherwise, filter out members that are outside the bbox
				extracted.relations.addRelation({
					...relation,
					members: relation.members.filter((m) => {
						if (m.type === "node") return nodeIds.has(m.ref)
						if (m.type === "way") return wayIds.has(m.ref)
						if (m.type === "relation") {
							const nestedRelation = osm.relations.getById(m.ref)
							if (!nestedRelation) return false
							// Include nested relation if it has intersecting members
							const nestedResolved = resolveRelationMembers(
								nestedRelation,
								(relId) => osm.relations.getById(relId),
							)
							return (
								nestedResolved.nodes.some((id) => nodeIds.has(id)) ||
								nestedResolved.ways.some((id) => wayIds.has(id))
							)
						}
						return false
					}),
				})
			}
		}
	}

	extracted.buildIndexes()
	extracted.buildSpatialIndexes()
	return extracted
}
