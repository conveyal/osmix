import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import type { Osm, OsmEntity } from "osm.ts"

export const osmAtomFamily = atomFamily((id: string) => atom<Osm | null>(null))
export const osmFileAtomFamily = atomFamily((id: string) =>
	atom<File | null>(null),
)
export const selectedEntityAtom = atom<OsmEntity | null>(null)
export const selectedOsmAtom = atom<Osm | null>(null)

export const selectOsmEntityAtom = atom(
	null,
	(_get, set, osm: Osm | null, entity: OsmEntity | null) => {
		set(selectedOsmAtom, osm)
		set(selectedEntityAtom, entity)
	},
)
