import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

export const mapBoundsAtom = atom<maplibregl.LngLatBounds | null>(null)
export const zoomAtom = atom<number | null>(null)
export const mapCenterAtom = atom<maplibregl.LngLat | null>(null)

export const routingControlIsOpenAtom = atomWithStorage(
	"@osmix:map:routingIsOpen",
	false,
)
export const layerControlIsOpenAtom = atomWithStorage(
	"@osmix:map:layerControlIsOpen",
	false,
)
export const searchControlIsOpenAtom = atomWithStorage(
	"@osmix:map:searchIsOpen",
	false,
)
export const osmFileControlIsOpenAtom = atomWithStorage(
	"@osmix:map:osmFileControlIsOpen",
	true,
)
