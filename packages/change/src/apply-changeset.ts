/**
 * Changeset application utilities.
 *
 * Applies accumulated changes from an OsmChangeset to produce a new Osm index
 * with all creates, modifies, and deletes applied immutably.
 *
 * @module
 */

import { Osm } from "@osmix/core";

import type { OsmChangeset } from "./changeset.ts";
import { assertNoNewRoutingIntegrityIssues, reuseRoutingIntegrityAnalysis } from "./integrity.ts";

function hasOwnChanges(changes: Record<number, unknown>) {
  for (const key in changes) {
    if (Object.hasOwn(changes, key)) return true;
  }
  return false;
}

function isEmptyChangeset(changeset: OsmChangeset) {
  return (
    !hasOwnChanges(changeset.nodeChanges) &&
    !hasOwnChanges(changeset.wayChanges) &&
    !hasOwnChanges(changeset.relationChanges)
  );
}

/**
 * Apply a changeset to an Osm index, producing a new Osm index.
 *
 * Creates a fresh Osm instance and applies all changes from the changeset:
 * - Entities marked for deletion are excluded
 * - Modified entities use the updated version from the changeset
 * - Created entities are added to the new index
 *
 * The original base Osm remains immutable. After application, the new Osm
 * has built ID, tag, and spatial indexes.
 *
 * @param changeset - The changeset to apply (contains reference to base Osm).
 * @param newOsmId - Optional ID for the new Osm index (defaults to base ID).
 * @returns A new Osm index with all changes applied.
 * @throws If changeset contains invalid change sequences (e.g., create for existing entity).
 *
 * @example
 * ```ts
 * const changeset = new OsmChangeset(baseOsm)
 * changeset.generateDirectChanges(patchOsm)
 * changeset.deduplicateNodes(patchOsm.nodes)
 * const newOsm = applyChangesetToOsm(changeset)
 * ```
 */
export function applyChangesetToOsm(changeset: OsmChangeset, newOsmId?: string) {
  const baseOsm = changeset.osm;
  if (isEmptyChangeset(changeset)) {
    // Keep the documented fresh-result behavior while reusing finalized,
    // immutable typed buffers and spatial indexes for a true no-op. This is
    // important for empty-patch identity merges on large base datasets.
    const osm = new Osm({
      ...baseOsm.transferables(),
      id: newOsmId ?? baseOsm.id,
    });
    if (!osm.hasSpatialIndexes()) osm.buildSpatialIndexes();
    // The wrapper above references the exact same finalized entity buffers.
    // Carry the source analysis forward so the next merge stage can reuse it.
    reuseRoutingIntegrityAnalysis(baseOsm, osm);
    assertNoNewRoutingIntegrityIssues(changeset.routingIntegrityBaselineKeys, osm);
    return osm;
  }

  const osm = new Osm({
    id: newOsmId ?? baseOsm.id,
    header: baseOsm.header,
  });

  const { nodeChanges, wayChanges, relationChanges } = changeset;

  // Add nodes from base, modifying and deleting as needed
  for (const node of baseOsm.nodes) {
    const change = nodeChanges[node.id];
    if (change) {
      if (change.changeType === "delete") continue; // Don't add deleted nodes
      if (change.changeType === "create")
        throw Error("Changeset contains create changes for existing entities");
    }
    osm.nodes.addNode(change?.entity ?? node);
  }

  // All remaining node changes should be create
  // Add nodes from patch
  for (const idText in nodeChanges) {
    if (!Object.hasOwn(nodeChanges, idText)) continue;
    const change = nodeChanges[Number(idText)]!;
    if (change.changeType === "create") {
      osm.nodes.addNode(change.entity);
      continue;
    }
    if (!baseOsm.nodes.ids.has(Number(idText))) {
      throw Error("Changeset still contains node changes in incorrect stage.");
    }
  }

  // Add ways from base, modifying and deleting as needed
  for (const way of baseOsm.ways) {
    const change = wayChanges[way.id];
    if (change) {
      if (change.changeType === "delete") continue; // Don't add deleted ways
      if (change.changeType === "create") {
        throw Error("Changeset contains create changes for existing entities");
      }
    }
    // Remove duplicate refs back to back, but not when they are separated by other refs
    osm.ways.addWay(change?.entity ?? way);
  }

  // All remaining way changes should be create
  // Add ways from patch
  for (const idText in wayChanges) {
    if (!Object.hasOwn(wayChanges, idText)) continue;
    const change = wayChanges[Number(idText)]!;
    if (change.changeType === "create") {
      osm.ways.addWay(change.entity);
      continue;
    }
    if (!baseOsm.ways.ids.has(Number(idText))) {
      throw Error("Changeset still contains way changes in incorrect stage.");
    }
  }

  // Add relations from base, modifying and deleting as needed
  for (const relation of baseOsm.relations) {
    const change = relationChanges[relation.id];
    if (change) {
      if (change.changeType === "delete") continue; // Don't add deleted relations
      if (change.changeType === "create") {
        throw Error("Changeset contains create changes for existing entities");
      }
    }
    osm.relations.addRelation(change?.entity ?? relation);
  }

  // Add relations from patch
  for (const idText in relationChanges) {
    if (!Object.hasOwn(relationChanges, idText)) continue;
    const change = relationChanges[Number(idText)]!;
    if (change.changeType === "create") {
      osm.relations.addRelation(change.entity);
      continue;
    }
    if (!baseOsm.relations.ids.has(Number(idText))) {
      throw Error("Changeset still contains relation changes in incorrect stage.");
    }
  }

  // Everything should be added now, finish the osm
  osm.buildIndexes();

  // Build spatial indexes
  osm.buildSpatialIndexes();

  assertNoNewRoutingIntegrityIssues(changeset.routingIntegrityBaselineKeys, osm);

  return osm;
}
