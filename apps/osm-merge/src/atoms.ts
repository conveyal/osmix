import { GeoJsonLayer } from "@deck.gl/layers"
import { distance } from "@turf/turf"
import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import { Osm, type OsmNode, mergeOsm } from "osm.ts"
import { generateOsmChanges } from "osm.ts/changes"
import { nodeToFeature, wayToEditableGeoJson } from "osm.ts/geojson"
import type { OsmChange } from "osm.ts"
import { isWay } from "osm.ts/utils"

const LINE_WIDTH_METERS = 3
const POINT_RADIUS_METERS = 1.5

const MIN_WIDTH_PIXELS = 1
const MAX_WIDTH_PIXELS = 10
const MIN_RADIUS_PIXELS = 1
const MAX_RADIUS_PIXELS = 5

declare global {
	interface Window {
		osm: {
			base: Osm | null
			patch: Osm | null
		}
	}
}

if (typeof window !== "undefined") {
	window.osm = {
		base: null,
		patch: null,
	}
}

type WorkflowStep =
	| "view"
	| "select-files"
	| "verify-changes"
	| "deduplicate-nodes"
	| "create-intersections"
	| "merge-complete"

export const workflowStepAtom = atom<WorkflowStep>("select-files")

export const fileAtomFamily = atomFamily((_: "base" | "patch") =>
	atom<File | null>(null),
)
export const osmAtomFamily = atomFamily((name: "base" | "patch") =>
	atom(async (get) => {
		const file = get(fileAtomFamily(name))
		if (!file) return null
		const osm = await Osm.fromPbfData(file.stream())
		window.osm[name] = osm
		return osm
	}),
)

export const patchesAtom = atom<OsmChange[]>([])
export const patchIndexAtom = atom(-1)
export const currentChangeEntityAtom = atom(async (get) => {
	const patchIndex = get(patchIndexAtom)
	const patchOsm = await get(osmAtomFamily("patch"))
	const patches = get(patchesAtom)
	if (patches.length === 0 || !patchOsm || patchIndex < 0) return null
	const patch = patches[patchIndex]
	if (!patch) return null
	return patch.entity
})

export const currentChangeEntityBboxAtom = atom(async (get) => {
	const changeEntity = await get(currentChangeEntityAtom)
	const patchOsm = await get(osmAtomFamily("patch"))
	if (!changeEntity || !patchOsm) return null
	return patchOsm.getEntityBbox(changeEntity)
})

export const beginMergeAtom = atom(null, async (get, set) => {
	const baseOsm = await get(osmAtomFamily("base"))
	const patchOsm = await get(osmAtomFamily("patch"))
	if (!baseOsm || !patchOsm) return
	set(workflowStepAtom, "verify-changes")
	set(patchesAtom, generateOsmChanges(baseOsm, patchOsm))
	set(patchIndexAtom, 0)
})

export const applyAllChangesAtom = atom(null, async (get, set) => {
	const baseOsm = await get(osmAtomFamily("base"))
	const changes = get(patchesAtom)
	if (!baseOsm || changes.length === 0) return
	baseOsm.applyChanges(changes)
	set(patchIndexAtom, -1)
	set(patchesAtom, [])
	set(workflowStepAtom, "deduplicate-nodes")
})

type Status = {
	type: "info" | "ready" | "error"
	message: string
	duration: number
	timestamp: number
}

export const logAtom = atom<Status[]>([
	{
		type: "info",
		message: "Initializing application...",
		duration: 0,
		timestamp: Date.now(),
	},
])

export const addLogMessageAtom = atom(
	null,
	(get, set, message: string, type: Status["type"] = "info") => {
		const log = get(logAtom)
		const msSinceLastLog = Date.now() - log[log.length - 1].timestamp
		const durationSeconds = `${(msSinceLastLog / 1000).toFixed(2)}s`
		if (type === "error") {
			console.error(`${type} (${durationSeconds}):`, message)
		} else {
			console.log(`${type} (${durationSeconds}):`, message)
		}
		set(logAtom, [
			...log,
			{
				type,
				message,
				duration: msSinceLastLog,
				timestamp: Date.now(),
			},
		])
	},
)

export const currentStatusAtom = atom((get) => {
	const log = get(logAtom)
	return log[log.length - 1]
})

export const runFullMergeAtom = atom(null, async (get, set) => {
	set(addLogMessageAtom, "Running automatic merge.")
	const patchOsm = await get(osmAtomFamily("patch"))
	const baseOsm = await get(osmAtomFamily("base"))
	if (!patchOsm || !baseOsm) return

	try {
		mergeOsm(baseOsm, patchOsm, (message, type) => {
			set(addLogMessageAtom, message, type)
		})

		set(fileAtomFamily("patch"), null)

		set(addLogMessageAtom, "Merge complete.", "ready")
		set(workflowStepAtom, "merge-complete")
	} catch (error) {
		set(addLogMessageAtom, "Error running automatic merge.", "error")
		console.error(error)
	}
})

type NodeCandidate = {
	patchNode: OsmNode
	baseNode: OsmNode
	distance: number
}

export const baseNodesNearPatchAtom = atom(async (get) => {
	const patchOsm = await get(osmAtomFamily("patch"))
	const baseOsm = await get(osmAtomFamily("base"))
	const way = await get(currentChangeEntityAtom)
	if (!patchOsm || !baseOsm || !way || !isWay(way)) return []
	const candidates: NodeCandidate[] = []
	for (const ref of way.refs) {
		const patchNode = patchOsm.nodes.getById(ref)
		if (!patchNode) continue
		const baseNodes = baseOsm.nodes.within(patchNode.lon, patchNode.lat, 0.001)
		for (const baseNodeIndex of baseNodes) {
			const baseNode = baseOsm.nodes.getByIndex(baseNodeIndex)
			if (!baseNode) continue
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
	const workflowStep = get(workflowStepAtom)
	return new GeoJsonLayer({
		id: "osm-tk:patch-geojson",
		data:
			workflowStep !== "merge-complete" ? patchOsm?.toGeoJSON(includeNode) : [],
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
	const patchWay = await get(currentChangeEntityAtom)
	const workflowStep = get(workflowStepAtom)
	return new GeoJsonLayer({
		id: "osm-tk:patch-way-geojson",
		data:
			workflowStep !== "merge-complete" &&
			patchWay &&
			patchOsm &&
			isWay(patchWay)
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
	const workflowStep = get(workflowStepAtom)
	return new GeoJsonLayer({
		id: "osm-tk:base-nodes-near-patch-geojson",
		data:
			workflowStep !== "merge-complete"
				? baseNodesNearPatch.map((node) => nodeToFeature(node.baseNode))
				: [],
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
