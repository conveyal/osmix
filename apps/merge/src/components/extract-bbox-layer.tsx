import type { GeoBbox2D } from "@osmix/shared/types"
import type { FeatureCollection } from "geojson"
import type {
	FillLayerSpecification,
	LineLayerSpecification,
} from "maplibre-gl"
import { Layer, Source } from "react-map-gl/maplibre"
import { APPID } from "../settings"

const SOURCE_ID = `${APPID}:extract-bbox`
const FILL_LAYER_ID = `${APPID}:extract-bbox-fill`
const LINE_LAYER_ID = `${APPID}:extract-bbox-line`

function bboxToFeatureCollection(bbox: GeoBbox2D): FeatureCollection {
	const [w, s, e, n] = bbox
	return {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: {},
				geometry: {
					type: "Polygon",
					coordinates: [
						[
							[w, s],
							[e, s],
							[e, n],
							[w, n],
							[w, s],
						],
					],
				},
			},
		],
	}
}

const fillPaint: FillLayerSpecification["paint"] = {
	"fill-color": "#3b82f6",
	"fill-opacity": 0.12,
}

const linePaint: LineLayerSpecification["paint"] = {
	"line-color": "#2563eb",
	"line-width": 2,
}

export default function ExtractBboxLayer({ bbox }: { bbox: GeoBbox2D }) {
	const data = bboxToFeatureCollection(bbox)
	return (
		<Source id={SOURCE_ID} type="geojson" data={data}>
			<Layer id={FILL_LAYER_ID} type="fill" paint={fillPaint} />
			<Layer id={LINE_LAYER_ID} type="line" paint={linePaint} />
		</Source>
	)
}
