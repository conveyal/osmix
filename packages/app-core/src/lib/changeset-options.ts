import type { OsmChangesetOptions } from "osmix";

/**
 * Find exact duplicate nodes and ways inside one dataset. Generating the changeset leaves the
 * dataset unchanged; applying it keeps the highest compatible ID and rewrites references to it.
 */
export const WITHIN_DATASET_DEDUPLICATION_OPTIONS = {
  deduplicateNodes: true,
  deduplicateWays: true,
} as const satisfies Partial<OsmChangesetOptions>;
