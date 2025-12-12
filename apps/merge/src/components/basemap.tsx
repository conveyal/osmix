import { useSetAtom } from "jotai"
import { useCallback } from "react"
import {
	Map as MaplibreMap,
	ScaleControl,
	type ViewStateChangeEvent,
} from "react-map-gl/maplibre"
import { mapBoundsAtom, mapCenterAtom, zoomAtom } from "../state/map"
import MapLayerControl from "./map-layer-control"
import NominatimSearchControl from "./nominatim-search-control"
import RouteMapControl from "./route-control"

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

	const onViewStateChange = useCallback(
		(e: ViewStateChangeEvent) => {
			setBounds(e.target.getBounds())
			setCenter(e.target.getCenter())
			setZoom(e.target.getZoom())
		},
		[setBounds, setCenter, setZoom],
	)

	return (
		<MaplibreMap
			mapStyle={MAP_STYLE}
			reuseMaps={true}
			initialViewState={initialViewState}
			onMove={onViewStateChange}
			onZoom={onViewStateChange}
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
