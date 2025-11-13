import type { OsmEntity, OsmEntityType, OsmEntityTypeMap } from "@osmix/json"

// String that starts with `n`, `w`, or `r` followed by the ID
export type OsmEntityRef = {
	type: OsmEntityType
	id: number
	osmId: string
}

export type OsmChangeTypes = "modify" | "create" | "delete"

export type OsmChange<T extends OsmEntity = OsmEntity> = {
	changeType: OsmChangeTypes
	entity: T
	osmId: string // When merging datasets, we need to keep track of the entity's origin dataset.

	// Used to lookup related entities, refs, and relations
	refs?: OsmEntityRef[]
}

export interface OsmMergeOptions {
	directMerge: boolean
	deduplicateNodes: boolean
	deduplicateWays: boolean
	createIntersections: boolean
	logger: (message: string) => void
}

export type OsmChangesetStats = {
	osmId: string
	totalChanges: number
	nodeChanges: number
	wayChanges: number
	relationChanges: number
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
	stats: OsmChangesetStats
}
