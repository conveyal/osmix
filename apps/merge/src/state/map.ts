import { atom } from "jotai"

export const mapBoundsAtom = atom<maplibregl.LngLatBounds | null>(null)
export const zoomAtom = atom<number | null>(null)
export const mapCenterAtom = atom<maplibregl.LngLat | null>(null)

export const routingControlIsOpenAtom = atom(false)
export const layerControlIsOpenAtom = atom(false)
export const searchControlIsOpenAtom = atom(false)
