import type { OsmChangesetOptions } from "osmix";

/** Detect duplicate nodes and ways inside one dataset without changing it. */
export const WITHIN_DATASET_DIAGNOSTIC_OPTIONS = {
  deduplicateNodes: true,
  deduplicateWays: true,
} as const satisfies Partial<OsmChangesetOptions>;
