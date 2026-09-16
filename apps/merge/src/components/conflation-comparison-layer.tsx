import { useAtomValue } from "jotai";
import type { LineLayerSpecification } from "maplibre-gl";
import { useState } from "react";
import { Layer, Marker, Source } from "react-map-gl/maplibre";

import { comparisonCoordinate, comparisonLocations } from "../lib/conflation-comparison";
import { APPID } from "../settings";
import { conflationComparisonAtom } from "../state/conflation";
import { ComparisonMarkerSymbol } from "./conflation-comparison-evidence";

const SOURCE_ID = `${APPID}:conflation-comparison`;

/** Resolve the CSS tokens into sRGB strings accepted by MapLibre's style parser. */
function mapComparisonColors() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  const read = (token: string) => {
    probe.style.color = `var(${token})`;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${red}, ${green}, ${blue})`;
  };
  const colors = { source: read("--destructive"), target: read("--info") };
  probe.remove();
  return colors;
}

export function ConflationComparisonLayer() {
  const comparison = useAtomValue(conflationComparisonAtom);
  const [colors] = useState(() => mapComparisonColors());
  const locations = comparisonLocations(comparison);
  const basePaint: LineLayerSpecification["paint"] = {
    "line-color": colors?.target,
    "line-width": 7,
  };
  const importedPaint: LineLayerSpecification["paint"] = {
    "line-color": colors?.source,
    "line-width": 3,
    "line-dasharray": [2, 2],
  };
  return (
    <>
      {colors ? (
        <Source id={SOURCE_ID} type="geojson" data={comparison}>
          <Layer
            id={`${SOURCE_ID}:outline`}
            type="line"
            paint={{ "line-color": "white", "line-width": 11 }}
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
      ) : null}
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
