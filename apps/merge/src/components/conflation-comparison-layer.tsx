import { APPID, useMapColors } from "@osmix/app-components";
import { useAtomValue } from "jotai";
import type { LineLayerSpecification } from "maplibre-gl";
import { Layer, Marker, Source } from "react-map-gl/maplibre";

import { comparisonCoordinate, comparisonLocations } from "../lib/conflation-comparison";
import { conflationComparisonAtom } from "../state/conflation";
import { ComparisonMarkerSymbol } from "./conflation-comparison-evidence";

const SOURCE_ID = `${APPID}:conflation-comparison`;

export function ConflationComparisonLayer() {
  const comparison = useAtomValue(conflationComparisonAtom);
  const colors = useMapColors();
  const locations = comparisonLocations(comparison);
  const basePaint: LineLayerSpecification["paint"] = {
    "line-color": colors.base,
    "line-width": 7,
  };
  const importedPaint: LineLayerSpecification["paint"] = {
    "line-color": colors.patch,
    "line-width": 3,
    "line-dasharray": [2, 2],
  };
  return (
    <>
      <Source id={SOURCE_ID} type="geojson" data={comparison}>
        <Layer
          id={`${SOURCE_ID}:outline`}
          type="line"
          paint={{ "line-color": colors.casing, "line-width": 11 }}
        />
        <Layer
          id={`${SOURCE_ID}:base-lines`}
          type="line"
          filter={["==", ["get", "role"], "target"]}
          paint={basePaint}
        />
        <Layer
          id={`${SOURCE_ID}:imported-lines`}
          type="line"
          filter={["==", ["get", "role"], "source"]}
          paint={importedPaint}
        />
      </Source>
      {locations.map((location) => (
        <Marker
          key={`${location.candidateId}:${location.role}:${location.location}`}
          longitude={location.longitude}
          latitude={location.latitude}
          anchor="center"
        >
          <span
            className="flex"
            data-slot="comparison-map-marker"
            data-role={location.role}
            role="img"
            aria-label={`${location.role === "target" ? "Base OSM circle" : "Imported feature diamond"}, ${location.location.toLowerCase()}, latitude ${comparisonCoordinate(location.latitude)}, longitude ${comparisonCoordinate(location.longitude)}`}
          >
            <ComparisonMarkerSymbol role={location.role} />
          </span>
        </Marker>
      ))}
    </>
  );
}
