/**
 * Node pruning for tag-filtered loads.
 *
 * @module
 */

import { MISSING_NODE_INDEX, Osm } from "@osmix/core";
import { BitSet } from "@osmix/shared/bit-set";

import { entityMatchesTagRules, type ExtractTagFilterRule } from "./extract-tag-filter.ts";
import { sortedIndexes } from "./sorted-indexes.ts";

/**
 * Remove nodes that nothing references and that do not match `nodeRules`.
 *
 * Keeps every node referenced by a way, every node member of a relation, and every node whose
 * tags match `nodeRules` (any rule matches; no rules keeps every node). Ways and relations are
 * copied unchanged, so ways stay reference complete for every node they had in the source.
 *
 * Returns a new `Osm` with ID and tag indexes built and no spatial indexes. Returns `osm` itself
 * when no node would be removed.
 */
export function pruneUnreferencedNodes(osm: Osm, nodeRules: ExtractTagFilterRule[]): Osm {
  if (!osm.isReady()) throw Error("Osm is not ready for node pruning.");
  if (nodeRules.length === 0) return osm;

  const keep = new BitSet(osm.nodes.size);
  for (let wayIndex = 0; wayIndex < osm.ways.size; wayIndex++) {
    const refIndexes = osm.ways.getRefIndexes(wayIndex);
    for (let i = 0; i < refIndexes.length; i++) {
      const nodeIndex = refIndexes[i]!;
      if (nodeIndex !== MISSING_NODE_INDEX) keep.add(nodeIndex);
    }
  }
  for (let relationIndex = 0; relationIndex < osm.relations.size; relationIndex++) {
    for (const member of osm.relations.getByIndex(relationIndex).members) {
      if (member.type !== "node") continue;
      const nodeIndex = osm.nodes.ids.getIndexFromId(member.ref);
      if (nodeIndex !== -1) keep.add(nodeIndex);
    }
  }
  const nodeTags = osm.nodes.tags;
  for (let nodeIndex = 0; nodeIndex < osm.nodes.size; nodeIndex++) {
    if (keep.has(nodeIndex) || nodeTags.cardinality(nodeIndex) === 0) continue;
    if (entityMatchesTagRules(nodeTags.getTags(nodeIndex), nodeRules)) keep.add(nodeIndex);
  }
  if (keep.count === osm.nodes.size) return osm;

  const pruned = new Osm({ id: osm.id, header: osm.header });
  for (const nodeIndex of sortedIndexes(keep, osm.nodes.ids)) {
    pruned.nodes.addNode(osm.nodes.getByIndex(nodeIndex));
  }
  for (let wayIndex = 0; wayIndex < osm.ways.size; wayIndex++) {
    pruned.ways.addWay(osm.ways.getByIndex(wayIndex));
  }
  for (let relationIndex = 0; relationIndex < osm.relations.size; relationIndex++) {
    pruned.relations.addRelation(osm.relations.getByIndex(relationIndex));
  }
  pruned.buildIndexes();
  return pruned;
}
