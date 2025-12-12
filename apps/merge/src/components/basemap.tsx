import { useSetAtom } from "jotai"
import { useCallback, useRef } from "react"
import {
	Map as MaplibreMap,
	ScaleControl,
	type ViewStateChangeEvent,
} from "react-map-gl/maplibre"
import { APPID, BASE_MAP_STYLES, DEFAULT_BASE_MAP_STYLE } from "../settings"
import { mapBoundsAtom, mapCenterAtom, zoomAtom } from "../state/map"
import MapLayerControl from "./map-layer-control"
import NominatimSearchControl from "./nominatim-search-control"
import RouteMapControl from "./route-control"

const MAP_CENTER = [-120.5, 46.6] as const // Yakima, WA
const MAP_ZOOM = 10

const initialViewState = {
	longitude: MAP_CENTER[0],
	latitude: MAP_CENTER[1],
	zoom: MAP_ZOOM,
}

const controlStyle: React.CSSProperties = {
	borderRadius: "var(--radius)",
}

export default function Basemap({ children }: { children?: React.ReactNode }) {
	const setCenter = useSetAtom(mapCenterAtom)
	const setBounds = useSetAtom(mapBoundsAtom)
	const setZoom = useSetAtom(zoomAtom)
	const hasHiddenLayersRef = useRef(false)

	const onViewStateChange = useCallback(
		(e: ViewStateChangeEvent) => {
			setBounds(e.target.getBounds())
			setCenter(e.target.getCenter())
			setZoom(e.target.getZoom())
		},
		[setBounds, setCenter, setZoom],
	)

	// Hide roads in base map - only run once on initial style load
	const onStyleData = useCallback((e: maplibregl.MapStyleDataEvent) => {
		if (hasHiddenLayersRef.current) return

		const map = e.target
		const style = map.getStyle()
		if (!style?.layers) return

		for (const layer of style.layers) {
			if (layer.id.startsWith(APPID)) continue
			if (layer.type === "line" || layer.type === "symbol") {
				map.setLayoutProperty(layer.id, "visibility", "none")
			}
		}

		hasHiddenLayersRef.current = true
	}, [])

	return (
		<MaplibreMap
			reuseMaps={true}
			mapStyle={BASE_MAP_STYLES[DEFAULT_BASE_MAP_STYLE]}
			initialViewState={initialViewState}
			onMove={onViewStateChange}
			onZoom={onViewStateChange}
			onStyleData={onStyleData}
		>
			<ScaleControl
				style={controlStyle}
				position="bottom-left"
				unit="imperial"
			/>

			<MapLayerControl />
			<RouteMapControl />
			<NominatimSearchControl />

			{children}
		</MaplibreMap>
	)
}
