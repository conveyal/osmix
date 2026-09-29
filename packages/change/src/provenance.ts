/**
 * Where each entity in a merge came from: the base input, the patch input, or both (a same-ID
 * update). Stages ask this explicitly instead of testing ID membership in whichever dataset they
 * happen to hold, so the answer stays correct once earlier stages have rewritten the data.
 */
import type { Osm } from "@osmix/core";

type MergeEntityKind = "node" | "way" | "relation";

export interface MergeProvenance {
  /** In the base input, including base entities a same-ID patch entity updates. */
  isBase(type: MergeEntityKind, id: number): boolean;
  /** In the patch input. */
  isPatch(type: MergeEntityKind, id: number): boolean;
  /** In both inputs: the patch updates this base entity by ID. */
  isSameId(type: MergeEntityKind, id: number): boolean;
  /** In the patch only: new imported data. */
  isImported(type: MergeEntityKind, id: number): boolean;
}

function has(osm: Osm, type: MergeEntityKind, id: number) {
  return type === "node"
    ? osm.nodes.ids.has(id)
    : type === "way"
      ? osm.ways.ids.has(id)
      : osm.relations.ids.has(id);
}

/** Provenance read from the two untouched inputs. */
export function inputProvenance(base: Osm, patch: Osm): MergeProvenance {
  return {
    isBase: (type, id) => has(base, type, id),
    isPatch: (type, id) => has(patch, type, id),
    isSameId: (type, id) => has(base, type, id) && has(patch, type, id),
    isImported: (type, id) => has(patch, type, id) && !has(base, type, id),
  };
}
