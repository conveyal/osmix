import { useAtomValue } from "jotai"
import { useEffect, useMemo } from "react"
import {
	type CircleLayerSpecification,
	Layer,
	type LineLayerSpecification,
	Source,
} from "react-map-gl/maplibre"
import { APPID } from "@/settings"
import { mapAtom } from "@/state/map"
import { selectedEntityAtom, selectedOsmAtom } from "@/state/osm"

const SOURCE_ID = `${APPID}:selected-entity`
const LINE_ID = `${APPID}:selected-line`
const POINTS_ID = `${APPID}:selected-points`

const linePaint: LineLayerSpecification["paint"] = {
	"line-color": "red",
	"line-width": [
		"interpolate",
		["linear"],
		["zoom"],
		5,
		1,
		10,
		3,
		14,
		6,
		18,
		12,
	],
	"line-opacity": 1,
}

const lineLayout: LineLayerSpecification["layout"] = {
	"line-cap": "round",
	"line-join": "round",
}

const circlePaint: CircleLayerSpecification["paint"] = {
	"circle-color": "white",
	"circle-radius": [
		"interpolate",
		["linear"],
		["zoom"],
		5,
		0.5,
		10,
		1,
		14,
		2,
		18,
		6,
	],
	"circle-stroke-color": "red",
	"circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 18, 4],
}

const circleLayout: CircleLayerSpecification["layout"] = {}

export default function SelectedEntityLayer() {
	const map = useAtomValue(mapAtom)
	const selectedOsm = useAtomValue(selectedOsmAtom)
	const selectedEntity = useAtomValue(selectedEntityAtom)
	const geojson: GeoJSON.GeoJSON = useMemo(() => {
		if (!selectedOsm || !selectedEntity)
			return { type: "FeatureCollection", features: [] }
		return selectedOsm.getEntityGeoJson(selectedEntity)
	}, [selectedEntity, selectedOsm])

	useEffect(() => {
		if (!map) return
		const ids = [LINE_ID, POINTS_ID]
		const moveTop = () =>
			ids.forEach((id) => {
				if (map.getLayer(id)) map.moveLayer(id)
			})
		if (map.isStyleLoaded()) moveTop()
		map.on("styledata", moveTop)
		return () => {
			map.off("styledata", moveTop)
		}
	}, [map])

	return (
		<Source id={SOURCE_ID} type="geojson" data={geojson}>
			<Layer id={LINE_ID} type="line" paint={linePaint} layout={lineLayout} />
			<Layer
				id={POINTS_ID}
				type="circle"
				paint={circlePaint}
				layout={circleLayout}
			/>
		</Source>
	)
}
