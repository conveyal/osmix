import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import type { Osm, OsmInfo, OsmLoadProfile } from "osmix";
import type { OsmEntity } from "osmix";

import { nameDataset } from "../lib/dataset-names.ts";
import type { OsmLoadFailure } from "../lib/osm-load-failure.ts";
import { slotOsmId } from "../lib/slot-osm-id.ts";
import type { StoredFileInfo } from "../workers/osmix-app.worker.ts";

export const osmInfoAtomFamily = atomFamily((_id: string) => atom<OsmInfo | null>(null));
export const osmAtomFamily = atomFamily((_id: string) => atom<Osm | null>(null));
export const osmFileAtomFamily = atomFamily((_id: string) => atom<File | null>(null));
/**
 * A slot's file metadata. Setting it names the slot's dataset, and the stored file it came from,
 * in the Activity log (`nameDataset`).
 */
export const osmFileInfoAtomFamily = atomFamily((osmKey: string) => {
  const fileInfo = atom<StoredFileInfo | null>(null);
  return atom(
    (get) => get(fileInfo),
    (_get, set, next: StoredFileInfo | null) => {
      if (next) {
        nameDataset(next.fileHash, next.fileName);
        nameDataset(slotOsmId(osmKey, next.fileHash), next.fileName);
      }
      set(fileInfo, next);
    },
  );
});
export const osmStoredAtomFamily = atomFamily((_id: string) => atom<boolean>(false));
/** Merge explicitly opts into automatic memory-aware PBF loading. */
export const osmLoadProfileAtomFamily = atomFamily((_id: string) => atom<OsmLoadProfile>("auto"));
export const osmLoadFailureAtomFamily = atomFamily((_id: string) =>
  atom<OsmLoadFailure | null>(null),
);
export const selectedEntityAtom = atom<OsmEntity | null>(null);
export const selectedOsmAtom = atom<Osm | null>(null);

/**
 * Where the current selection came from: a map click, with the clicked point in CSS pixels
 * from the map's top-left corner, or anything else (search, a list, a clear). The inspector
 * reads a map origin once, to nudge the map when the panel it opens covers the clicked point,
 * then sets it back to `other`.
 */
export type SelectionOrigin = { source: "map"; point: [number, number] } | { source: "other" };

export const selectionOriginAtom = atom<SelectionOrigin>({ source: "other" });

export const selectOsmEntityAtom = atom(
  null,
  (
    _get,
    set,
    osm: Osm | null,
    entity: OsmEntity | null,
    origin: SelectionOrigin = { source: "other" },
  ) => {
    set(selectedOsmAtom, osm);
    set(selectedEntityAtom, entity);
    set(selectionOriginAtom, origin);
  },
);
