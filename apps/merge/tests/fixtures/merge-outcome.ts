import type { OsmConflationOutcomeReport } from "osmix";

export function emptyMatchingOutcome(): OsmConflationOutcomeReport {
  return {
    stage: "matching-before-intersections",
    summary: {
      features: 0,
      appliedFeatures: 0,
      tagCopyActions: 0,
      copiedTagValues: 0,
      networkAttachmentActions: 0,
      unresolvedFeatures: 0,
      ambiguousFeatures: 0,
      blockedFeatures: 0,
      unmatchedFeatures: 0,
      reviewFeatures: 0,
      skippedFeatures: 0,
      unchangedFeatures: 0,
    },
    features: [],
    tags: [],
    retainedImports: {
      originalIds: { nodes: 0, ways: 0, relations: 0 },
      ordinaryAdditions: { nodes: 0, ways: 0, relations: 0 },
    },
  };
}
