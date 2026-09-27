/**
 * Patch IDs follow the OSM convention: negative means new, positive means an edit of the base
 * entity with that ID. Two unrelated imports both number new features from -1, so negative
 * patch IDs are moved below the base's lowest ID before planning; they can never collide.
 */
import { Osm } from "@osmix/core";
import type { OsmEntityType } from "@osmix/types";

import type { PatchIdMode } from "./types.ts";

export interface PatchIdRemap {
  mode: PatchIdMode;
  /** Original patch ID to planned ID, for IDs that change only. */
  node: Map<number, number>;
  way: Map<number, number>;
  relation: Map<number, number>;
}

type IdIndex = Osm["nodes"]["ids"];

function lowestId(ids: IdIndex): number {
  if (ids.size === 0) return 0;
  if (ids.isReady()) return ids.sorted[0] ?? 0;
  let lowest = ids.at(0);
  for (let index = 1; index < ids.size; index++) lowest = Math.min(lowest, ids.at(index));
  return lowest;
}

function remapIds(baseIds: IdIndex, patchIds: IdIndex, mode: PatchIdMode) {
  const floor = Math.min(lowestId(baseIds), 0);
  const remap = new Map<number, number>();
  if (mode === "new") {
    const ids = Array.from({ length: patchIds.size }, (_, index) => patchIds.at(index));
    ids.sort((a, b) => a - b);
    for (const [rank, id] of ids.entries()) remap.set(id, floor - rank - 1);
    return remap;
  }
  if (floor === 0) return remap;
  for (let index = 0; index < patchIds.size; index++) {
    const id = patchIds.at(index);
    if (id < 0) remap.set(id, id + floor);
  }
  return remap;
}

/** The planned IDs for a patch against a base. Empty maps when no ID changes. */
export function planPatchIdRemap(base: Osm, patch: Osm, mode: PatchIdMode): PatchIdRemap {
  return {
    mode,
    node: remapIds(base.nodes.ids, patch.nodes.ids, mode),
    way: remapIds(base.ways.ids, patch.ways.ids, mode),
    relation: remapIds(base.relations.ids, patch.relations.ids, mode),
  };
}

export function remappedCount(remap: PatchIdRemap) {
  return remap.node.size + remap.way.size + remap.relation.size;
}

export function remapId(remap: PatchIdRemap, type: OsmEntityType, id: number) {
  return remap[type].get(id) ?? id;
}

/** The patch with planned IDs, refs and members; the patch itself when nothing changes. */
export function remapPatch(patch: Osm, remap: PatchIdRemap): Osm {
  if (remappedCount(remap) === 0) return patch;
  const remapped = new Osm({ id: patch.id, header: patch.header });
  for (const node of patch.nodes) {
    remapped.nodes.addNode({ ...node, id: remapId(remap, "node", node.id) });
  }
  for (const way of patch.ways) {
    remapped.ways.addWay({
      ...way,
      id: remapId(remap, "way", way.id),
      refs: way.refs.map((ref) => remapId(remap, "node", ref)),
    });
  }
  for (const relation of patch.relations) {
    remapped.relations.addRelation({
      ...relation,
      id: remapId(remap, "relation", relation.id),
      members: relation.members.map((member) => ({
        ...member,
        ref: remapId(remap, member.type, member.ref),
      })),
    });
  }
  remapped.buildIndexes();
  remapped.buildSpatialIndexes();
  return remapped;
}
