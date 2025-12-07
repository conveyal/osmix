/**
 * Type definitions for OSM changeset operations.
 * @module
 */

import type {
	OsmEntity,
	OsmEntityType,
	OsmEntityTypeMap,
} from "@osmix/shared/types"

/**
 * Reference to an OSM entity with its origin dataset.
 * Used to track provenance when merging multiple datasets.
 */
export type OsmEntityRef = {
	type: OsmEntityType
	id: number
	osmId: string
}

/** The type of change being tracked. */
export type OsmChangeTypes = "modify" | "create" | "delete"

/**
 * A single change record for an OSM entity.
 * Tracks the change type, the entity state, origin dataset, and related references.
 */
export type OsmChange<T extends OsmEntity = OsmEntity> = {
	changeType: OsmChangeTypes
	entity: T
	osmId: string // When merging datasets, we need to keep track of the entity's origin dataset.

	// Used to lookup related entities, refs, and relations
	refs?: OsmEntityRef[]
}

/**
 * Options for the high-level `merge()` function.
 * All options default to `false` - enable only the stages you need.
 */
export interface OsmMergeOptions {
	directMerge: boolean
	deduplicateNodes: boolean
	deduplicateWays: boolean
	createIntersections: boolean
}

/**
 * Statistics from a changeset operation.
 * Provides counts of changes and deduplication results.
 */
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

/**
 * Serializable representation of all changes in a changeset.
 * Used for JSON export/import of changeset state.
 */
export type OsmChanges = {
	osmId: string
	nodes: Record<number, OsmChange<OsmEntityTypeMap["node"]>>
	ways: Record<number, OsmChange<OsmEntityTypeMap["way"]>>
	relations: Record<number, OsmChange<OsmEntityTypeMap["relation"]>>
	stats: OsmChangesetStats
}
