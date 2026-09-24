import { useAtomValue } from "jotai";
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
import { routingGeoJsonAtom } from "../state/routing.ts";

const SOURCE_ID = `${APPID}:route`;
const LINE_ID = `${SOURCE_ID}:route-line`;
const CASING_ID = `${LINE_ID}:casing`;
const SNAP_LINES_ID = `${APPID}:route-snap-lines`;
const TURN_POINTS_ID = `${SOURCE_ID}:route-turn-points`;
const CLICK_POINTS_ID = `${SOURCE_ID}:route-click-points`;
const SNAP_POINTS_ID = `${SOURCE_ID}:route-snap-points`;

const routeLineLayout: LineLayerSpecification["layout"] = {
  "line-cap": "round",
  "line-join": "round",
};

/**
 * Route paint. The route and snapped nodes use `route` over a `casing`; the raw click points and
 * the dashed lines from each click to its snapped node use `routeError`, marking where the click
 * fell off the routable network.
 */
function routePaints(colors: MapColors) {
  const casing: LineLayerSpecification["paint"] = {
    "line-color": colors.casing,
    "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 11, 18, 20],
    "line-opacity": 1,
  };
  const line: LineLayerSpecification["paint"] = {
    "line-color": colors.route,
    "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 8, 18, 16],
    "line-opacity": 1,
  };
  const snapLine: LineLayerSpecification["paint"] = {
    "line-color": colors.routeError,
    "line-width": 3,
    "line-dasharray": [2, 2],
    "line-opacity": 1,
  };
  const turnPoints: CircleLayerSpecification["paint"] = {
    "circle-color": colors.casing,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 5, 18, 8],
    "circle-stroke-color": colors.route,
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2, 18, 3],
  };
  const clickPoints: CircleLayerSpecification["paint"] = {
    "circle-color": colors.routeError,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 10, 18, 16],
    "circle-stroke-color": colors.casing,
    "circle-stroke-width": 3,
  };
  const snapPoints: CircleLayerSpecification["paint"] = {
    "circle-color": colors.casing,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8, 18, 12],
    "circle-stroke-color": colors.route,
    "circle-stroke-width": 3,
  };
  return { casing, line, snapLine, turnPoints, clickPoints, snapPoints };
}

export default function RouteLayer() {
  const map = useMap();
  const colors = useMapColors();
  const paints = useMemo(() => routePaints(colors), [colors]);
  const geojson = useAtomValue(routingGeoJsonAtom);

  // Move route layers to top whenever geojson changes (new route added)
  useEffect(() => {
    if (!map || geojson.features.length === 0) return;
    const ids = [
      SNAP_LINES_ID,
      CASING_ID,
      LINE_ID,
      TURN_POINTS_ID,
      SNAP_POINTS_ID,
      CLICK_POINTS_ID,
    ];
    for (const id of ids) {
      if (map.getLayer(id)) map.moveLayer(id);
    }
  }, [map, geojson]);

  return (
    <Source id={SOURCE_ID} type="geojson" data={geojson}>
      {/* Snap lines (dashed) - rendered first */}
      <Layer
        id={SNAP_LINES_ID}
        type="line"
        filter={["==", ["get", "layer"], "snap-line"]}
        paint={paints.snapLine}
      />
      {/* Route casing and line - rendered on top of snap lines */}
      <Layer
        id={CASING_ID}
        type="line"
        filter={["==", ["get", "layer"], "route"]}
        paint={paints.casing}
        layout={routeLineLayout}
      />
      <Layer
        id={LINE_ID}
        type="line"
        filter={["==", ["get", "layer"], "route"]}
        paint={paints.line}
        layout={routeLineLayout}
      />
      {/* Turn points (small cased dots where the way name changes) */}
      <Layer
        id={TURN_POINTS_ID}
        type="circle"
        filter={["==", ["get", "layer"], "turn-point"]}
        paint={paints.turnPoints}
      />
      {/* Click points */}
      <Layer
        id={CLICK_POINTS_ID}
        type="circle"
        filter={["==", ["get", "layer"], "click-point"]}
        paint={paints.clickPoints}
      />
      {/* Snapped nodes */}
      <Layer
        id={SNAP_POINTS_ID}
        type="circle"
        filter={["==", ["get", "layer"], "snap-point"]}
        paint={paints.snapPoints}
      />
    </Source>
  );
}
