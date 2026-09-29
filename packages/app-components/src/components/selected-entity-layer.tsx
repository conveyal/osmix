import { selectedEntityAtom, selectedOsmAtom } from "@osmix/app-core";
import { useAtomValue } from "jotai";
import type { ExpressionSpecification } from "maplibre-gl";
import { osmEntityToGeoJSONFeature } from "osmix";
import { normalizeHexColor } from "osmix";
import { useEffect, useMemo } from "react";
import {
  type CircleLayerSpecification,
  Layer,
  type LineLayerSpecification,
  Source,
} from "react-map-gl/maplibre";

import { APPID } from "../constants.ts";
import { type MapColors, useMapColors } from "../hooks/map-colors.ts";
import { useMap } from "../hooks/map.ts";

const SOURCE_ID = `${APPID}:selected-entity`;
const LINE_ID = `${APPID}:selected-line`;
const POINTS_ID = `${APPID}:selected-points`;
const OUTLINE_ID = `${LINE_ID}:outline`;

const lineLayout: LineLayerSpecification["layout"] = {
  "line-cap": "round",
  "line-join": "round",
};

const circleLayout: CircleLayerSpecification["layout"] = {};

/** Selection paint: the feature's own `color` when present, else `selected`, over a casing. */
function selectionPaints(colors: MapColors) {
  const selectionColor: ExpressionSpecification = [
    "case",
    ["has", "color"],
    ["to-color", ["get", "color"]],
    colors.selected,
  ];
  const line: LineLayerSpecification["paint"] = {
    "line-color": selectionColor,
    "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 2, 18, 10],
    "line-opacity": 1,
  };
  const outline: LineLayerSpecification["paint"] = {
    "line-color": colors.casing,
    "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 3, 18, 15],
  };
  const circle: CircleLayerSpecification["paint"] = {
    "circle-color": colors.casing,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 3, 18, 6],
    "circle-stroke-color": selectionColor,
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 2],
  };
  return { line, outline, circle };
}

export default function SelectedEntityLayer() {
  const map = useMap();
  const colors = useMapColors();
  const paints = useMemo(() => selectionPaints(colors), [colors]);
  const selectedOsm = useAtomValue(selectedOsmAtom);
  const selectedEntity = useAtomValue(selectedEntityAtom);
  const geojson: GeoJSON.GeoJSON = useMemo(() => {
    if (!selectedOsm || !selectedEntity) return { type: "FeatureCollection", features: [] };
    const feature = osmEntityToGeoJSONFeature(selectedOsm, selectedEntity);
    if (feature.type !== "Feature" || !feature.properties) return feature;
    const properties = feature.properties as Record<string, unknown>;
    const colorValue = properties["color"];
    const colourValue = properties["colour"];
    const normalizedColor = normalizeHexColor(
      typeof colorValue === "string" || typeof colorValue === "number"
        ? colorValue
        : typeof colourValue === "string" || typeof colourValue === "number"
          ? colourValue
          : undefined,
    );
    if (!normalizedColor) return feature;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        color: normalizedColor,
      },
    };
  }, [selectedEntity, selectedOsm]);

  useEffect(() => {
    if (!map || !selectedEntity) return;
    const ids = [OUTLINE_ID, LINE_ID, POINTS_ID];
    ids.forEach((id) => {
      if (map.getLayer(id)) map.moveLayer(id);
    });
  }, [map, selectedEntity]);

  return (
    <Source id={SOURCE_ID} type="geojson" data={geojson}>
      <Layer id={OUTLINE_ID} type="line" layout={lineLayout} paint={paints.outline} />
      <Layer id={LINE_ID} type="line" paint={paints.line} layout={lineLayout} />
      <Layer id={POINTS_ID} type="circle" paint={paints.circle} layout={circleLayout} />
    </Source>
  );
}
