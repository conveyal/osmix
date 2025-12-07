/**
 * @osmix/change - OSM changeset management and merge workflows.
 *
 * Provides tools for building, inspecting, and applying OpenStreetMap changesets
 * on top of `@osmix/core` datasets. Supports deduplication, overlap reconciliation,
 * intersection creation, and full merge pipelines.
 *
 * Key capabilities:
 * - **Changesets**: Track creates, modifies, and deletes with origin metadata.
 * - **Deduplication**: Remove coincident nodes or overlapping ways.
 * - **Intersections**: Create intersection nodes where ways cross.
 * - **Merging**: Combine base and patch datasets with configurable options.
 * - **Statistics**: Generate summary stats and OSC-friendly XML fragments.
 *
 * @example
 * ```ts
 * import { OsmChangeset, applyChangesToOsm, merge } from "@osmix/change"
 *
 * // Manual changeset workflow
 * const changeset = new OsmChangeset(baseOsm)
 * changeset.deduplicateNodes(baseOsm.nodes)
 * changeset.generateDirectChanges(patchOsm)
 * const merged = applyChangesToOsm(changeset)
 *
 * // Or use the high-level merge function
 * const result = merge(baseOsm, patchOsm, {
 *   directMerge: true,
 *   deduplicateNodes: true,
 * })
 * ```
 *
 * @module @osmix/change
 */

export * from "./apply-changeset"
export * from "./changeset"
export * from "./generate-changeset"
export * from "./merge"
export * from "./osc"
export * from "./types"
export * from "./utils"
