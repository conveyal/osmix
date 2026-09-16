import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { LngLat, LngLatBounds } from "maplibre-gl";

export const mapBoundsAtom = atom<LngLatBounds | null>(null);
export const zoomAtom = atom<number | null>(null);
export const mapCenterAtom = atom<LngLat | null>(null);

export const routingControlIsOpenAtom = atomWithStorage("@osmix:map:routingIsOpen", false);
export const layerControlIsOpenAtom = atomWithStorage("@osmix:map:layerControlIsOpen", false);
export const searchControlIsOpenAtom = atomWithStorage("@osmix:map:searchIsOpen", false);
export const osmFileControlIsOpenAtom = atomWithStorage("@osmix:map:osmFileControlIsOpen", true);
