/**
 * The staged merge pipeline `merge()` ran before it became plan and apply: direct and exact
 * changes, applied; matching discovered on the untouched inputs and applied to that result;
 * intersections as a last changeset. The differential tests use it as the oracle for the
 * planner until the staged APIs are removed.
 */
import { applyChangesetToOsm, generateChangeset, type OsmMergeOptions } from "@osmix/change";
import {
  discoverConflationCandidatesForTrustedMerge,
  generateConflationApplicationArtifactsFromTrustedDiscovery,
} from "@osmix/change/internal/conflation";
import type { Osm } from "@osmix/core";

export async function stagedMerge(
  base: Osm,
  patch: Osm,
  options: Partial<OsmMergeOptions> = {},
  onProgress: () => void = () => {},
): Promise<Osm> {
  let modifiedBase = base;
  if (options.directMerge || options.deduplicateNodes || options.deduplicateWays) {
    const changeset = generateChangeset(
      base,
      patch,
      {
        directMerge: options.directMerge ?? false,
        deduplicateNodes: options.deduplicateNodes ?? false,
        deduplicateWays: options.deduplicateWays ?? false,
        createIntersections: false,
      },
      onProgress,
    );
    modifiedBase = applyChangesetToOsm(changeset);
  }
  if (options.conflation) {
    const discovery = discoverConflationCandidatesForTrustedMerge(base, patch, options.conflation);
    modifiedBase = generateConflationApplicationArtifactsFromTrustedDiscovery(
      modifiedBase,
      patch,
      discovery,
      base,
      options.conflation.decisions ?? [],
    ).result;
  }
  if (options.createIntersections) {
    const changeset = generateChangeset(
      modifiedBase,
      patch,
      { createIntersections: true },
      onProgress,
    );
    modifiedBase = applyChangesetToOsm(changeset);
  }
  return modifiedBase;
}
