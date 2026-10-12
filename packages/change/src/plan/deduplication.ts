/**
 * Duplicates inside one dataset, found with the rules exact reconciliation uses across two
 * (the node-identity rulebook): nodes at the same seven-decimal coordinate, then ways with the
 * same ordered refs and routing tags. The highest compatible ID survives, and way refs and
 * relation members move to it (MP-I5).
 */
import type { Osm } from "@osmix/core";
import { logProgress, type ProgressEvent, progressEvent } from "@osmix/shared/progress";

import { OsmChangeset } from "../changeset.ts";

/**
 * Plan removing duplicates from `osm` without changing it. The returned changes list every
 * removal and rewrite; `applyChangesetToOsm` builds the cleaned dataset.
 */
export function planWithinDatasetDeduplication(
  osm: Osm,
  onProgress: (progress: ProgressEvent) => void = logProgress,
): OsmChangeset {
  const changeset = new OsmChangeset(osm);
  onProgress(progressEvent(`Finding duplicate nodes in ${osm.id}...`));
  changeset.deduplicateNodes(osm.nodes);
  onProgress(progressEvent(`Finding duplicate ways in ${osm.id}...`));
  for (const _ of changeset.deduplicateWaysGenerator(osm.ways));
  onProgress(
    progressEvent(
      `Duplicates: ${changeset.deduplicatedNodes.toLocaleString()} nodes, ${changeset.deduplicatedWays.toLocaleString()} ways`,
    ),
  );
  return changeset;
}
