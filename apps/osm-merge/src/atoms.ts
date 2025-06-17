import { atom } from "jotai"
import type { MapRef } from "react-map-gl/maplibre"
import { GeoJsonLayer } from "@deck.gl/layers"
import { atomFamily } from "jotai/utils"
import { Osm, type Bbox, type OsmNode } from "osm.ts"
import { bbox, distance } from "@turf/turf"
import { nodeToFeature, wayToEditableGeoJson } from "osm.ts/src/to-geojson"

export const mapAtom = atom<MapRef | null>(null)
export const zoomAtom = atom<number | null>(null)
export const mapCenterAtom = atom<maplibregl.LngLat | null>(null)

const LINE_WIDTH_METERS = 3
const POINT_RADIUS_METERS = 1.5

const MIN_WIDTH_PIXELS = 1
const MAX_WIDTH_PIXELS = 10
const MIN_RADIUS_PIXELS = 1
const MAX_RADIUS_PIXELS = 5

export const fileAtomFamily = atomFamily((_: "base" | "patch") =>
	atom<File | null>(null),
)
export const osmAtomFamily = atomFamily((name: "base" | "patch") =>
	atom(async (get) => {
		const file = get(fileAtomFamily(name))
		if (!file) return null
		return Osm.fromPbfData(file.stream())
	}),
)

type Patch = {
	type: "add" | "delete" | "update"
	wayId: number
}
export const patchesAtom = atom<Patch[]>([])
export const patchIndexAtom = atom(-1)
export const currentWayAtom = atom(async (get) => {
	const patchIndex = get(patchIndexAtom)
	const patchOsm = await get(osmAtomFamily("patch"))
	const patches = get(patchesAtom)
	if (patches.length === 0 || !patchOsm || patchIndex < 0) return null
	const patch = patches[patchIndex]
	if (!patch) return null
	return patchOsm.getWay(patch.wayId)
})

export const currentWayBboxAtom = atom(async (get) => {
	const way = await get(currentWayAtom)
	const patchOsm = await get(osmAtomFamily("patch"))
	if (!way || !patchOsm) return null
	return bbox(patchOsm.wayToLineString(way)) as Bbox
})

export const beginMergeAtom = atom(null, async (get, set) => {
	const patchOsm = await get(osmAtomFamily("patch"))
	if (!patchOsm) return
	set(
		patchesAtom,
		Array.from(patchOsm.ways.values()).map((way) => ({
			wayId: way.id,
			type: "add",
		})) as Patch[],
	)
	set(patchIndexAtom, 0)
})

type NodeCandidate = {
	patchNode: OsmNode
	baseNode: OsmNode
	distance: number
}

export const baseNodesNearPatchAtom = atom(async (get) => {
	const patchOsm = await get(osmAtomFamily("patch"))
	const baseOsm = await get(osmAtomFamily("base"))
	const way = await get(currentWayAtom)
	if (!patchOsm || !baseOsm || !way) return []
	const candidates: NodeCandidate[] = []
	for (const ref of way.refs) {
		const patchNode = patchOsm.nodes.get(ref)
		if (!patchNode) continue
		const baseNodes = baseOsm.nodeIndex.nodesWithin(
			patchNode.lon,
			patchNode.lat,
			0.001,
		)
		for (const baseNode of baseNodes) {
			const d = distance(
				[patchNode.lon, patchNode.lat],
				[baseNode.lon, baseNode.lat],
				{ units: "meters" },
			)
			if (d > 10) continue
			if (d < 1) console.log("STRICT MATCH", patchNode.id, baseNode.id)
			candidates.push({
				patchNode,
				baseNode,
				distance: d,
			})
		}
	}
	return candidates
})

function includeNode(node: OsmNode) {
	if (!node.tags) return false
	const keys = Object.keys(node.tags)
	return keys.filter((key) => !key.startsWith("ext:osm_version")).length > 0
}

export const patchGeoJsonLayerAtom = atom(async (get) => {
	const patchOsm = await get(osmAtomFamily("patch"))
	return new GeoJsonLayer({
		id: "osm-tk:patch-geojson",
		data: patchOsm?.toGeoJSON(includeNode),
		pickable: true,
		getFillColor: [255, 255, 255],
		getPointRadius: (d) => {
			if (d.geometry.type === "Point") {
				return POINT_RADIUS_METERS
			}
			return 0
		},
		pointRadiusUnits: "meters",
		pointRadiusMinPixels: MIN_RADIUS_PIXELS,
		pointRadiusMaxPixels: MAX_RADIUS_PIXELS,
		getLineColor: (d) => {
			if (d.geometry.type === "Point") {
				return [0, 255, 0]
			}
			return [0, 255, 0]
		},
		getLineWidth: (d) => {
			if (d.geometry.type === "Point" || d.geometry.type === "Polygon") {
				return 0
			}
			return LINE_WIDTH_METERS
		},
		lineWidthUnits: "meters",
		lineWidthMaxPixels: MAX_WIDTH_PIXELS,
		lineWidthMinPixels: MIN_WIDTH_PIXELS,
		lineJointRounded: true,
		opacity: 0.75,
	})
})

export const patchWayGeoJsonLayerAtom = atom(async (get) => {
	const patchOsm = await get(osmAtomFamily("patch"))
	const patchWay = await get(currentWayAtom)
	return new GeoJsonLayer({
		id: "osm-tk:patch-way-geojson",
		data:
			patchWay && patchOsm
				? wayToEditableGeoJson(patchWay, patchOsm.nodes)
				: [],
		pickable: true,
		pointRadiusMaxPixels: MAX_RADIUS_PIXELS,
		pointRadiusMinPixels: MIN_RADIUS_PIXELS,
		getPointRadius: POINT_RADIUS_METERS,
		pointRadiusUnits: "meters",
		getFillColor: [255, 255, 255],
		getLineColor: [255, 0, 0, 255],
		getLineWidth: (d) => {
			if (d.geometry.type === "Point" || d.geometry.type === "Polygon") {
				return 0
			}
			return LINE_WIDTH_METERS
		},
		lineWidthUnits: "meters",
		lineWidthMaxPixels: MAX_WIDTH_PIXELS,
		lineWidthMinPixels: MIN_WIDTH_PIXELS,
		lineJointRounded: true,
	})
})

export const baseGeoJsonLayerAtom = atom(async (get) => {
	const baseOsm = await get(osmAtomFamily("base"))
	return new GeoJsonLayer({
		id: "osm-tk:base-geojson",
		data: baseOsm?.toGeoJSON(),
		pickable: true,
		pointRadiusMaxPixels: MAX_RADIUS_PIXELS,
		pointRadiusMinPixels: MIN_RADIUS_PIXELS,
		getPointRadius: POINT_RADIUS_METERS,
		pointRadiusUnits: "meters",
		autoHighlight: true,
		highlightColor: [255, 0, 0, 0.5 * 255],
		getFillColor: (d) => {
			if (d.geometry.type === "Polygon") {
				return [255, 255, 255]
			}
			if (d.geometry.type === "Point") {
				return [255, 255, 255]
			}
			return [0, 0, 0, 0]
		},
		getLineColor: [255, 255, 255],
		getLineWidth: (d) => {
			if (d.geometry.type === "Point" || d.geometry.type === "Polygon") {
				return 0
			}
			return LINE_WIDTH_METERS
		},
		lineWidthMaxPixels: MAX_WIDTH_PIXELS,
		lineWidthMinPixels: MIN_WIDTH_PIXELS,
		lineWidthUnits: "meters",
		lineJointRounded: true,
		opacity: 0.75,
	})
})

export const baseNodesNearPatchGeoJsonLayerAtom = atom(async (get) => {
	const baseNodesNearPatch = await get(baseNodesNearPatchAtom)
	return new GeoJsonLayer({
		id: "osm-tk:base-nodes-near-patch-geojson",
		data: baseNodesNearPatch.map((node) => nodeToFeature(node.baseNode)),
		pickable: true,
		pointRadiusMaxPixels: MAX_RADIUS_PIXELS * 2,
		pointRadiusMinPixels: MIN_RADIUS_PIXELS * 2,
		getPointRadius: POINT_RADIUS_METERS * 2,
		pointRadiusUnits: "meters",
		getFillColor: [255, 255, 0],
		getLineWidth: 0,
	})
})

export const deckGlLayersAtom = atom(async (get) => {
	const baseGeoJsonLayer = await get(baseGeoJsonLayerAtom)
	const patchGeoJsonLayer = await get(patchGeoJsonLayerAtom)
	const patchWayGeoJsonLayer = await get(patchWayGeoJsonLayerAtom)
	const baseNodesNearPatchGeoJsonLayer = await get(
		baseNodesNearPatchGeoJsonLayerAtom,
	)
	return [
		baseGeoJsonLayer,
		patchGeoJsonLayer,
		patchWayGeoJsonLayer,
		baseNodesNearPatchGeoJsonLayer,
	].filter(Boolean)
})
