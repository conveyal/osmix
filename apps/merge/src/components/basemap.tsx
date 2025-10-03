import { useSetAtom } from "jotai"
import {
	Map as MaplibreMap,
	NavigationControl,
	ScaleControl,
} from "react-map-gl/maplibre"

import { mapAtom, mapCenterAtom, zoomAtom } from "@/state/map"

const MAP_STYLE =
	"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
const MAP_CENTER = [-120.5, 46.6] as const // Yakima, WA
const MAP_ZOOM = 10

export default function Basemap({
	children,
	longitude,
	latitude,
	zoom,
}: {
	children?: React.ReactNode
	longitude?: number
	latitude?: number
	zoom?: number
}) {
	const setCenter = useSetAtom(mapCenterAtom)
	const setMap = useSetAtom(mapAtom)
	const setZoom = useSetAtom(zoomAtom)
	return (
		<MaplibreMap
			mapStyle={MAP_STYLE}
			reuseMaps={true}
			initialViewState={{
				longitude: longitude ?? MAP_CENTER[0],
				latitude: latitude ?? MAP_CENTER[1],
				zoom: zoom ?? MAP_ZOOM,
			}}
			onLoad={(e) => {
				const map = e.target
				setCenter(map.getCenter())
				setZoom(map.getZoom())
			}}
			onMove={(e) => {
				setCenter(e.target.getCenter())
			}}
			onZoom={(e) => setZoom(e.viewState.zoom)}
			onStyleData={(e) => {
				// Hide roads in base map
				const map = e.target
				const style = map.getStyle()
				const layers = style.layers
				for (const layer of layers) {
					if (layer.id.startsWith("osm-tk")) continue
					if (layer.type === "line" || layer.type === "symbol") {
						map.setLayoutProperty(layer.id, "visibility", "none")
					}
				}
			}}
			ref={setMap}
		>
			<NavigationControl position="top-right" />
			<ScaleControl position="bottom-left" unit="imperial" />

			{children}
		</MaplibreMap>
	)
}
