/**
 * Geographic extraction from OSM indexes.
 *
 * Creates subsets of OSM data within bounding boxes using various strategies
 * that control how ways and relations at the boundary are handled.
 *
 * @module
 */

import { MISSING_NODE_INDEX, Osm } from "@osmix/core";
import { BitSet } from "@osmix/shared/bit-set";
import { logProgress, type ProgressEvent, progressEvent } from "@osmix/shared/progress";
import type { GeoBbox2D, OsmRelation, OsmRelationMember } from "@osmix/types";
import { resolveRelationMembers } from "@osmix/types/relation-kind";
import { isMultipolygonRelation } from "@osmix/types/utils";

const MAX_RELATION_DEPTH = 10;

/**
 * Strategy for handling entities at extract boundaries.
 * - `"simple"`: Strict spatial cut, may have incomplete geometries.
 * - `"complete_ways"`: Preserves complete way geometry, adds nodes outside bbox.
 * - `"smart"`: Like complete_ways, plus fully resolves multipolygon relations.
 */
export type ExtractStrategy = "simple" | "complete_ways" | "smart";

/**
 * Create a geographic extract from an existing Osm instance within a bounding box.
 *
 * Strategy "simple":
 * 1. Selects all nodes inside the bbox.
 * 2. Selects ways with at least one node inside the bbox, filtering refs to only include nodes inside the bbox.
 * 3. Selects relations with at least one member inside the bbox, filtering members to only include nodes and ways inside the bbox.
 *
 * Strategy "complete_ways":
 * 1. Selects all nodes inside the bbox.
 * 2. Selects ways with at least one node inside the bbox, adding missing way nodes from outside the bbox. All ways will be reference complete.
 * 3. Selects relations with at least one member inside the bbox leaving out any members that are not inside the bbox. Relations are not reference complete.
 *
 * Strategy "smart":
 * 1 & 2. Same as "complete_ways".
 * 3. Selects relations with at least one member inside the bbox, adding missing relation members from outside the bbox. Relations are reference complete. Members that the source itself lacks (e.g. boundaries cut by a regional file) are dropped and reported through `onProgress`.
 *
 * The "complete_ways" strategy preserves way geometry integrity but includes entities outside the bbox.
 * The "simple" strategy creates a strict spatial cut but may result in incomplete geometries.
 * Both strategies handle nested relations by resolving all descendant members.
 *
 * Selection does not depend on entity order: ways are selected by nodes inside the bbox only, and
 * relations are selected and filtered against the nodes and ways chosen for ways. Membership is
 * tracked as one bit per source entity index, so extracts scale past JS `Set` size limits. Output
 * entities are added in ascending ID order.
 *
 * See https://osmcode.org/osmium-tool/manual.html#creating-geographic-extracts for more details.
 */
export function createExtract(
  osm: Osm,
  bbox: GeoBbox2D,
  strategy: ExtractStrategy = "complete_ways",
  onProgress: (progress: ProgressEvent) => void = logProgress,
): Osm {
  if (!osm.isReady()) throw Error("Osm is not ready for extraction.");

  onProgress(
    progressEvent(
      `Creating extract ${osm.id} with strategy=${strategy} in bbox ${bbox.join(", ")}...`,
    ),
  );
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const extracted = new Osm({
    id: osm.id,
    header: {
      ...osm.header,
      bbox: {
        left: minLon,
        bottom: minLat,
        right: maxLon,
        top: maxLat,
      },
    },
  });
  const completeWays = strategy !== "simple";

  /** Add every node of a way to `target`, failing on refs to nodes absent from the source. */
  const addWayNodes = (wayIndex: number, target: BitSet) => {
    const refIndexes = osm.ways.getRefIndexes(wayIndex);
    for (let i = 0; i < refIndexes.length; i++) {
      const nodeIndex = refIndexes[i]!;
      if (nodeIndex === MISSING_NODE_INDEX) {
        throw Error(`Node ${osm.ways.getRefIds(wayIndex)[i]} not found`);
      }
      target.add(nodeIndex);
    }
  };

  onProgress(progressEvent("Extracting nodes..."));
  const inBbox = new BitSet(osm.nodes.size);
  for (const nodeIndex of osm.nodes.findIndexesWithinBbox(bbox)) inBbox.add(nodeIndex);

  onProgress(progressEvent("Extracting ways..."));
  // `inBbox` stays fixed while ways are selected; complete ways add their nodes to a copy.
  const selectedNodes = completeWays ? inBbox.clone() : inBbox;
  const selectedWays = new BitSet(osm.ways.size);
  for (let wayIndex = 0; wayIndex < osm.ways.size; wayIndex++) {
    if (!hasRefIn(osm.ways.getRefIndexes(wayIndex), inBbox)) continue;
    selectedWays.add(wayIndex);
    if (completeWays) addWayNodes(wayIndex, selectedNodes);
  }

  onProgress(progressEvent("Extracting relations..."));
  // Relation decisions read `selectedNodes`/`selectedWays`, which are now fixed. The smart
  // strategy's reference-complete additions go only into the emit sets.
  const emitNodes = strategy === "smart" ? selectedNodes.clone() : selectedNodes;
  const emitWays = strategy === "smart" ? selectedWays.clone() : selectedWays;
  const isNodeSelected = (id: number) => {
    const index = osm.nodes.ids.getIndexFromId(id);
    return index !== -1 && selectedNodes.has(index);
  };
  const isWaySelected = (id: number) => {
    const index = osm.ways.ids.getIndexFromId(id);
    return index !== -1 && selectedWays.has(index);
  };
  const getRelation = (id: number) => osm.relations.getById(id);

  const intersectingRelations = new BitSet(osm.relations.size);
  const selectedRelations = new BitSet(osm.relations.size);
  const completeRelations = new BitSet(osm.relations.size);
  /** Source index of a relation member, or -1 when the source file doesn't contain it. */
  const memberIndex = (member: OsmRelationMember): number => {
    if (member.type === "node") return osm.nodes.ids.getIndexFromId(member.ref);
    if (member.type === "way") return osm.ways.ids.getIndexFromId(member.ref);
    return osm.relations.ids.getIndexFromId(member.ref);
  };
  // Regional files cut large relations (country and maritime boundaries) at the region edge, so
  // members missing from the source are skipped rather than treated as errors.
  let skippedMembers = 0;
  /** Mark a relation reference complete, recursively adding its members to the emit sets. */
  const addCompleteRelation = (relationIndex: number, relation: OsmRelation): void => {
    if (completeRelations.has(relationIndex)) return;
    completeRelations.add(relationIndex);
    selectedRelations.add(relationIndex);
    for (const member of relation.members) {
      const index = memberIndex(member);
      if (index === -1) {
        skippedMembers++;
      } else if (member.type === "node") {
        emitNodes.add(index);
      } else if (member.type === "way") {
        if (emitWays.has(index)) continue;
        emitWays.add(index);
        addWayNodes(index, emitNodes);
      } else {
        addCompleteRelation(index, osm.relations.getByIndex(index));
      }
    }
  };

  for (let relationIndex = 0; relationIndex < osm.relations.size; relationIndex++) {
    const relation = osm.relations.getByIndex(relationIndex);
    // Resolve nested relations to get all descendant nodes and ways
    const resolved = resolveRelationMembers(relation, getRelation, MAX_RELATION_DEPTH);
    if (!resolved.nodes.some(isNodeSelected) && !resolved.ways.some(isWaySelected)) continue;
    intersectingRelations.add(relationIndex);
    selectedRelations.add(relationIndex);
    if (strategy === "smart" && isMultipolygonRelation(relation)) {
      // Add relation and recursively add direct members even if they're outside the bbox
      addCompleteRelation(relationIndex, relation);
    }
  }
  if (skippedMembers > 0) {
    onProgress(
      progressEvent(`Skipped ${skippedMembers} relation members missing from the source file.`),
    );
  }

  onProgress(progressEvent("Writing extract..."));
  for (const nodeIndex of sortedIndexes(emitNodes, osm.nodes.ids)) {
    extracted.nodes.addNode(osm.nodes.getByIndex(nodeIndex));
  }

  for (const wayIndex of sortedIndexes(emitWays, osm.ways.ids)) {
    const way = osm.ways.getByIndex(wayIndex);
    if (completeWays) {
      extracted.ways.addWay(way);
      continue;
    }
    const refIndexes = osm.ways.getRefIndexes(wayIndex);
    extracted.ways.addWay({
      ...way,
      refs: way.refs.filter((_, i) => {
        const nodeIndex = refIndexes[i]!;
        return nodeIndex !== MISSING_NODE_INDEX && inBbox.has(nodeIndex);
      }),
    });
  }

  for (const relationIndex of sortedIndexes(selectedRelations, osm.relations.ids)) {
    const relation = osm.relations.getByIndex(relationIndex);
    if (completeRelations.has(relationIndex)) {
      // Every member present in the source was added to the output.
      extracted.relations.addRelation({
        ...relation,
        members: relation.members.filter((m) => memberIndex(m) !== -1),
      });
      continue;
    }
    // Filter out members that are outside the selection
    extracted.relations.addRelation({
      ...relation,
      members: relation.members.filter((m) => {
        if (m.type === "node") return isNodeSelected(m.ref);
        if (m.type === "way") return isWaySelected(m.ref);
        if (m.type === "relation") {
          // Include nested relation if it has intersecting members
          const nestedIndex = osm.relations.ids.getIndexFromId(m.ref);
          return nestedIndex !== -1 && intersectingRelations.has(nestedIndex);
        }
        return false;
      }),
    });
  }

  extracted.buildIndexes();
  extracted.buildSpatialIndexes();
  return extracted;
}

/** Whether any resolvable node index in `refIndexes` is in `nodes`. */
function hasRefIn(refIndexes: Uint32Array, nodes: BitSet): boolean {
  for (let i = 0; i < refIndexes.length; i++) {
    const nodeIndex = refIndexes[i]!;
    if (nodeIndex !== MISSING_NODE_INDEX && nodes.has(nodeIndex)) return true;
  }
  return false;
}

/** Indexes of the set bits, ordered by the entity ID at each index. */
function sortedIndexes(set: BitSet, ids: { at(index: number): number }): Uint32Array {
  const indexes = new Uint32Array(set.count);
  let position = 0;
  set.forEach((index) => {
    indexes[position++] = index;
  });
  return indexes.sort((a, b) => ids.at(a) - ids.at(b));
}
