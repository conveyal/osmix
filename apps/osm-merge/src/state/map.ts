import { atom } from "jotai"
import type { MapRef } from "react-map-gl/maplibre"

export const mapAtom = atom<MapRef | null>(null)
export const zoomAtom = atom<number | null>(null)
export const mapCenterAtom = atom<maplibregl.LngLat | null>(null)
