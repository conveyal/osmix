import { useAtomValue } from "jotai"
import { useEffect } from "react"
import {
	type CircleLayerSpecification,
	Layer,
	type LineLayerSpecification,
	Source,
} from "react-map-gl/maplibre"
import { useMap } from "../hooks/map"
import { APPID } from "../settings"
import { routingGeoJsonAtom } from "../state/routing"

const SOURCE_ID = `${APPID}:route`
const LINE_ID = `${SOURCE_ID}:route-line`
const SNAP_LINES_ID = `${APPID}:route-snap-lines`
const TURN_POINTS_ID = `${SOURCE_ID}:route-turn-points`
const CLICK_POINTS_ID = `${SOURCE_ID}:route-click-points`
const SNAP_POINTS_ID = `${SOURCE_ID}:route-snap-points`

const routeLinePaint: LineLayerSpecification["paint"] = {
	"line-color": "#0088FF",
	"line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 8, 18, 16],
	"line-opacity": 1,
}

const routeLineLayout: LineLayerSpecification["layout"] = {
	"line-cap": "round",
	"line-join": "round",
}

const snapLinePaint: LineLayerSpecification["paint"] = {
	"line-color": "#FF4444",
	"line-width": 3,
	"line-dasharray": [2, 2],
	"line-opacity": 1,
}

const turnPointsPaint: CircleLayerSpecification["paint"] = {
	"circle-color": "white",
	"circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 5, 18, 8],
	"circle-stroke-color": "#0088FF",
	"circle-stroke-width": [
		"interpolate",
		["linear"],
		["zoom"],
		10,
		1,
		14,
		2,
		18,
		3,
	],
}

const clickPointsPaint: CircleLayerSpecification["paint"] = {
	"circle-color": "#FF4444",
	"circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 10, 18, 16],
	"circle-stroke-color": "white",
	"circle-stroke-width": 3,
}

const snapPointsPaint: CircleLayerSpecification["paint"] = {
	"circle-color": "white",
	"circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8, 18, 12],
	"circle-stroke-color": "#0088FF",
	"circle-stroke-width": 3,
}

export default function RouteLayer() {
	const map = useMap()
	const geojson = useAtomValue(routingGeoJsonAtom)

	// Move route layers to top whenever geojson changes (new route added)
	useEffect(() => {
		if (!map || geojson.features.length === 0) return
		const ids = [
			SNAP_LINES_ID,
			LINE_ID,
			TURN_POINTS_ID,
			SNAP_POINTS_ID,
			CLICK_POINTS_ID,
		]
		for (const id of ids) {
			if (map.getLayer(id)) map.moveLayer(id)
		}
	}, [map, geojson])

	return (
		<Source id={SOURCE_ID} type="geojson" data={geojson}>
			{/* Snap lines (dashed) - rendered first */}
			<Layer
				id={SNAP_LINES_ID}
				type="line"
				filter={["==", ["get", "layer"], "snap-line"]}
				paint={snapLinePaint}
			/>
			{/* Route line - rendered on top of snap lines */}
			<Layer
				id={LINE_ID}
				type="line"
				filter={["==", ["get", "layer"], "route"]}
				paint={routeLinePaint}
				layout={routeLineLayout}
			/>
			{/* Turn points (small white dots where way name changes) */}
			<Layer
				id={TURN_POINTS_ID}
				type="circle"
				filter={["==", ["get", "layer"], "turn-point"]}
				paint={turnPointsPaint}
			/>
			{/* Click points (red) */}
			<Layer
				id={CLICK_POINTS_ID}
				type="circle"
				filter={["==", ["get", "layer"], "click-point"]}
				paint={clickPointsPaint}
			/>
			{/* Snapped nodes (white with blue stroke) */}
			<Layer
				id={SNAP_POINTS_ID}
				type="circle"
				filter={["==", ["get", "layer"], "snap-point"]}
				paint={snapPointsPaint}
			/>
		</Source>
	)
}
