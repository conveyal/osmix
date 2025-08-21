import { atom } from "jotai"
import type { OsmEntity } from "osm.ts"
import type { MapRef } from "react-map-gl/maplibre"

export const mapAtom = atom<MapRef | null>(null)
export const zoomAtom = atom<number | null>(null)
export const mapCenterAtom = atom<maplibregl.LngLat | null>(null)
export const selectedEntityAtom = atom<OsmEntity | null>(null)
