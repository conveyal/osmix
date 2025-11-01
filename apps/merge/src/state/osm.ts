import type { Osmix } from "@osmix/core"
import type { OsmEntity } from "@osmix/json"
import { atom } from "jotai"
import { atomFamily } from "jotai/utils"

export const osmAtomFamily = atomFamily((_id: string) =>
	atom<Osmix | null>(null),
)
export const osmFileAtomFamily = atomFamily((_id: string) =>
	atom<File | null>(null),
)
export const selectedEntityAtom = atom<OsmEntity | null>(null)
export const selectedOsmAtom = atom<Osmix | null>(null)

export const selectOsmEntityAtom = atom(
	null,
	(_get, set, osm: Osmix | null, entity: OsmEntity | null) => {
		set(selectedOsmAtom, osm)
		set(selectedEntityAtom, entity)
	},
)
