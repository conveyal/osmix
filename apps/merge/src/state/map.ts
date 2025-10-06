import { atom } from "jotai"

export const mapAtom = atom<maplibregl.Map | null>(null)
export const mapBoundsAtom = atom<maplibregl.LngLatBounds | null>(null)
export const zoomAtom = atom<number | null>(null)
export const mapCenterAtom = atom<maplibregl.LngLat | null>(null)
