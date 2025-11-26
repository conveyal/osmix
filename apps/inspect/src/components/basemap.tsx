import { useSetAtom } from "jotai"
import { useCallback, useRef } from "react"
import {
	Map as MaplibreMap,
	type MapStyleDataEvent,
	NavigationControl,
	ScaleControl,
	type ViewStateChangeEvent,
} from "react-map-gl/maplibre"
import { APPID } from "../settings"
import { mapBoundsAtom, mapCenterAtom, zoomAtom } from "../state/map"

const MAP_STYLE =
	"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
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
	const onStyleData = useCallback((e: MapStyleDataEvent) => {
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
			mapStyle={MAP_STYLE}
			reuseMaps={true}
			initialViewState={initialViewState}
			onMove={onViewStateChange}
			onZoom={onViewStateChange}
			onStyleData={onStyleData}
		>
			<NavigationControl
				position="top-right"
				style={controlStyle}
				showCompass={false}
				visualizePitch={false}
			/>
			<ScaleControl
				style={controlStyle}
				position="bottom-left"
				unit="imperial"
			/>

			{children}
		</MaplibreMap>
	)
}
