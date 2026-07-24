import { useAtomValue } from "jotai";
import type { CircleLayerSpecification, LineLayerSpecification } from "maplibre-gl";
import { Layer, Source } from "react-map-gl/maplibre";

import { APPID } from "../settings";
import { conflationComparisonAtom } from "../state/conflation";

const SOURCE_ID = `${APPID}:conflation-comparison`;

const linePaint: LineLayerSpecification["paint"] = {
  "line-color": ["case", ["==", ["get", "role"], "source"], "#e11d48", "#0284c7"],
  "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 3, 18, 8],
  "line-opacity": 0.9,
};

const circlePaint: CircleLayerSpecification["paint"] = {
  "circle-color": ["case", ["==", ["get", "role"], "source"], "#e11d48", "#0284c7"],
  "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2, 14, 5, 18, 8],
  "circle-stroke-color": "white",
  "circle-stroke-width": 2,
};

export function ConflationComparisonLayer() {
  const comparison = useAtomValue(conflationComparisonAtom);

  return (
    <Source id={SOURCE_ID} type="geojson" data={comparison}>
      <Layer id={`${SOURCE_ID}:lines`} type="line" paint={linePaint} />
      <Layer id={`${SOURCE_ID}:points`} type="circle" paint={circlePaint} />
    </Source>
  );
}
