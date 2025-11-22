import { pointToTile, tileToGeoJSON } from "@mapbox/tilebelt"
import type { GeoBbox2D } from "@osmix/shared/types"
import type { Feature, FeatureCollection } from "geojson"
import type {
	GeoJSONSource,
	LineLayerSpecification,
	SymbolLayerSpecification,
} from "maplibre-gl"
import { useEffect } from "react"
import { Layer, Source } from "react-map-gl/maplibre"
import { useMap } from "../hooks/map"
import { APPID } from "../settings"

const EMPTY_COLLECTION: FeatureCollection = {
	type: "FeatureCollection",
	features: [],
}

const computeVisibleTiles = (
	[west, south, east, north]: GeoBbox2D,
	zoom: number,
) => {
	const [xMin, yMin] = pointToTile(west, north, zoom)
	const [xMax, yMax] = pointToTile(east, south, zoom)
	const tileSet: Feature[] = []

	for (let x = xMin; x <= xMax; x++) {
		for (let y = yMin; y <= yMax; y++) {
			tileSet.push({
				type: "Feature",
				geometry: tileToGeoJSON([x, y, zoom]),
				properties: {
					tileKey: `${x}/${y}/${zoom}`,
				},
			})
		}
	}

	return tileSet
}

export function useOsmixVectorOverlay() {}

const debugPaint: LineLayerSpecification["paint"] = {
	"line-color": ["rgba", 255, 0, 0, 0.35],
	"line-width": 1,
	"line-dasharray": [3, 3],
}

const debugSymbolLayout: SymbolLayerSpecification["layout"] = {
	"text-field": "{tileKey}",
	"text-size": 12,
	"text-allow-overlap": true,
}
const debugSymbolPaint: SymbolLayerSpecification["paint"] = {
	"text-color": ["rgba", 255, 255, 255, 0.5],
}

const DEBUG_SOURCE_ID = `${APPID}:debug:tile-bounds:source`
const DEBUG_LAYER_ID = `${APPID}:debug:tile-bounds:layer`
const DEBUG_SYMBOL_LAYER_ID = `${APPID}:debug:tile-bounds:symbol-layer`

export default function TileBoundsLayer() {
	const map = useMap()

	useEffect(() => {
		if (!map) return

		let disposed = false
		const updateTiles = () => {
			const source = map.getSource(DEBUG_SOURCE_ID) as GeoJSONSource
			if (disposed || !source) return
			const tiles = computeVisibleTiles(
				map.getBounds().toArray().flat() as GeoBbox2D,
				Math.floor(map.getZoom()),
			)
			source.setData({
				type: "FeatureCollection",
				features: tiles,
			})
		}

		updateTiles()
		map.on("moveend", updateTiles)
		map.on("zoomend", updateTiles)

		return () => {
			disposed = true
			map.off("moveend", updateTiles)
			map.off("zoomend", updateTiles)
		}
	}, [map])

	return (
		<Source id={DEBUG_SOURCE_ID} type="geojson" data={EMPTY_COLLECTION}>
			<Layer id={DEBUG_LAYER_ID} type="line" paint={debugPaint} />
			<Layer
				id={DEBUG_SYMBOL_LAYER_ID}
				type="symbol"
				layout={debugSymbolLayout}
				paint={debugSymbolPaint}
			/>
		</Source>
	)
}
