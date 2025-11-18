import { Osm } from "@osmix/core"
import {
	logProgress,
	type ProgressEvent,
	progressEvent,
} from "@osmix/shared/progress"
import type { GeoBbox2D } from "@osmix/shared/types"

type ExtractStrategy = "simple" | "complete_ways"

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
 * 2. Selects ways with at least one node inside the bbox, adding missing way nodes from outside the bbox.
 * 3. Selects relations with at least one member inside the bbox, adding missing relation members (nodes/ways) from outside the bbox.
 *
 * The "complete_ways" strategy preserves way and relation geometry integrity but includes entities outside the bbox.
 * The "simple" strategy creates a strict spatial cut but may result in incomplete geometries.
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
			if (strategy === "complete_ways") {
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
		if (
			relation.members.some((m) => {
				if (m.type === "node") return nodeIds.has(m.ref)
				if (m.type === "way") return wayIds.has(m.ref)
				return false
			})
		) {
			if (strategy === "complete_ways") {
				for (const member of relation.members) {
					if (member.type === "node") addNodeIfMissing(member.ref)
					if (member.type === "way") addWayIfMissing(member.ref)
				}
				extracted.relations.addRelation(relation)
			} else if (strategy === "simple") {
				extracted.relations.addRelation({
					...relation,
					members: relation.members.filter((m) => {
						if (m.type === "node") return nodeIds.has(m.ref)
						if (m.type === "way") return wayIds.has(m.ref)
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
