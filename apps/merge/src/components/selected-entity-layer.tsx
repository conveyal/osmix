import { useAtomValue } from "jotai"
import { useEffect, useMemo } from "react"
import {
	type CircleLayerSpecification,
	Layer,
	type LineLayerSpecification,
	Source,
} from "react-map-gl/maplibre"
import { useMap } from "@/hooks/map"
import { APPID } from "@/settings"
import { selectedEntityAtom, selectedOsmAtom } from "@/state/osm"

const SOURCE_ID = `${APPID}:selected-entity`
const LINE_ID = `${APPID}:selected-line`
const POINTS_ID = `${APPID}:selected-points`

const linePaint: LineLayerSpecification["paint"] = {
	"line-color": "red",
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 2, 18, 10],
	"line-opacity": 1,
}

const lineLayout: LineLayerSpecification["layout"] = {
	"line-cap": "round",
	"line-join": "round",
}

const circlePaint: CircleLayerSpecification["paint"] = {
	"circle-color": "white",
	"circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 3, 18, 6],
	"circle-stroke-color": "red",
	"circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 2],
}

const circleLayout: CircleLayerSpecification["layout"] = {}

export default function SelectedEntityLayer() {
	const map = useMap()
	const selectedOsm = useAtomValue(selectedOsmAtom)
	const selectedEntity = useAtomValue(selectedEntityAtom)
	const geojson: GeoJSON.GeoJSON = useMemo(() => {
		if (!selectedOsm || !selectedEntity)
			return { type: "FeatureCollection", features: [] }
		return selectedOsm.getEntityGeoJson(selectedEntity)
	}, [selectedEntity, selectedOsm])

	useEffect(() => {
		if (!map || !selectedEntity) return
		const ids = [LINE_ID, POINTS_ID]
		ids.forEach((id) => {
			if (map.getLayer(id)) map.moveLayer(id)
		})
	}, [map, selectedEntity])

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
