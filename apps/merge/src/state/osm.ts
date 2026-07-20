import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { Osm, OsmInfo, OsmLoadProfile } from "osmix";
import type { OsmEntity } from "osmix";

import type { OsmLoadFailure } from "../lib/osm-load-failure";
import type { StoredFileInfo } from "../workers/osm.worker";

export const osmInfoAtomFamily = atomFamily((_id: string) => atom<OsmInfo | null>(null));
export const osmAtomFamily = atomFamily((_id: string) => atom<Osm | null>(null));
export const osmFileAtomFamily = atomFamily((_id: string) => atom<File | null>(null));
export const osmFileInfoAtomFamily = atomFamily((_id: string) => atom<StoredFileInfo | null>(null));
export const osmStoredAtomFamily = atomFamily((_id: string) => atom<boolean>(false));
/** Merge explicitly opts into automatic memory-aware PBF loading. */
export const osmLoadProfileAtomFamily = atomFamily((_id: string) => atom<OsmLoadProfile>("auto"));
export const osmLoadFailureAtomFamily = atomFamily((_id: string) =>
  atom<OsmLoadFailure | null>(null),
);
export const selectedEntityAtom = atom<OsmEntity | null>(null);
export const selectedOsmAtom = atom<Osm | null>(null);

export const selectOsmEntityAtom = atom(
  null,
  (_get, set, osm: Osm | null, entity: OsmEntity | null) => {
    set(selectedOsmAtom, osm);
    set(selectedEntityAtom, entity);
  },
);
