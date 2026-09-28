import { APPID, useMapColors } from "@osmix/app-components";
import type { FeatureCollection } from "geojson";
import type { FillLayerSpecification, LineLayerSpecification } from "maplibre-gl";
import type { GeoBbox2D } from "osmix";
import { Layer, Source } from "react-map-gl/maplibre";

const SOURCE_ID = `${APPID}:extract-bbox`;
const FILL_LAYER_ID = `${APPID}:extract-bbox-fill`;
const LINE_LAYER_ID = `${APPID}:extract-bbox-line`;

const FILE_BOUNDS_SOURCE_ID = `${APPID}:extract-file-bounds`;
const FILE_BOUNDS_LINE_LAYER_ID = `${APPID}:extract-file-bounds-line`;

function bboxToFeatureCollection(bbox: GeoBbox2D): FeatureCollection {
  const [w, s, e, n] = bbox;
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
  };
}

/** The extract bounding box: a tinted rectangle with a solid outline. */
export default function ExtractBboxLayer({ bbox }: { bbox: GeoBbox2D }) {
  const colors = useMapColors();
  const data = bboxToFeatureCollection(bbox);
  const fillPaint: FillLayerSpecification["paint"] = {
    "fill-color": colors.bbox,
    "fill-opacity": 0.12,
  };
  const linePaint: LineLayerSpecification["paint"] = {
    "line-color": colors.bbox,
    "line-width": 2,
  };
  return (
    <Source id={SOURCE_ID} type="geojson" data={data}>
      <Layer id={FILL_LAYER_ID} type="fill" paint={fillPaint} />
      <Layer id={LINE_LAYER_ID} type="line" paint={linePaint} />
    </Source>
  );
}

/**
 * The selected file's header bounds: a long-dashed outline with no fill, so the user can see
 * where the file is when the extract bbox misses it. The dash is longer than the patch
 * overlay's `[2, 2]` so the outline never reads as patch data.
 */
export function ExtractFileBoundsLayer({ bbox }: { bbox: GeoBbox2D }) {
  const colors = useMapColors();
  const data = bboxToFeatureCollection(bbox);
  const linePaint: LineLayerSpecification["paint"] = {
    "line-color": colors.bbox,
    "line-width": 2,
    "line-dasharray": [6, 3],
  };
  return (
    <Source id={FILE_BOUNDS_SOURCE_ID} type="geojson" data={data}>
      <Layer id={FILE_BOUNDS_LINE_LAYER_ID} type="line" paint={linePaint} />
    </Source>
  );
}
