import type { OsmNode } from "@osmix/types";

import type { MergeProvenance } from "../provenance.ts";

/**
 * Whether an imported node can be dropped once a merge action stops using it: created by the
 * patch (never a base node), still present, untagged, and referenced by no remaining way or
 * relation. Removal and network connection share this rule, so neither discards data a person
 * would miss or leaves a dangling reference.
 */
export function isUnusedImportedNode(
  provenance: MergeProvenance,
  node: OsmNode | null | undefined,
  referenced: { byWay: boolean; byRelation: boolean },
): node is OsmNode {
  if (!node || !provenance.isImported("node", node.id)) return false;
  if (Object.keys(node.tags ?? {}).length > 0) return false;
  return !referenced.byWay && !referenced.byRelation;
}
