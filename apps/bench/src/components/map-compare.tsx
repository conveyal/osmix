import type { GeoBbox2D } from "@osmix/types";
import type { ExpressionSpecification } from "maplibre-gl";
import { useMemo, useState } from "react";
import { Layer, Map as MaplibreMap, type MapRef, Source } from "react-map-gl/maplibre";

import type { EngineName } from "../engines/types";
import type { GeoJSONFeatureRecord } from "../harness/compare";
import { ENGINE_NAMES } from "../harness/runner";

const BASE_COLOR = "#f5a623";
const ONLY_COLOR = "#ff2d55";

type Collection = GeoJSON.FeatureCollection & {
  features: (GeoJSON.Feature & GeoJSONFeatureRecord)[];
};

const featureKey = (feature: GeoJSONFeatureRecord) => `${feature.osm_type}/${feature.id}`;

/**
 * Parse both exports and flag features that only one engine produced. When the answers
 * match, nothing is flagged.
 */
function markDifferences(texts: Record<EngineName, string>) {
  const collections = {
    Osmix: JSON.parse(texts.Osmix) as Collection,
    DuckDB: JSON.parse(texts.DuckDB) as Collection,
  };
  const keys = {
    Osmix: new Set(collections.Osmix.features.map(featureKey)),
    DuckDB: new Set(collections.DuckDB.features.map(featureKey)),
  };
  const only = { Osmix: 0, DuckDB: 0 };
  for (const name of ENGINE_NAMES) {
    const other = keys[name === "Osmix" ? "DuckDB" : "Osmix"];
    for (const feature of collections[name].features) {
      const isOnly = !other.has(featureKey(feature));
      if (isOnly) only[name]++;
      feature.properties = { ...feature.properties, _only: isOnly };
    }
  }
  return { collections, only };
}

export function MapCompare({
  texts,
  bbox,
}: {
  texts: Record<EngineName, string>;
  bbox: GeoBbox2D;
}) {
  const { collections, only } = useMemo(() => markDifferences(texts), [texts]);
  return (
    <section>
      <h2>GeoJSON exports</h2>
      <p>
        Each map draws one engine's GeoJSON export. Features that only one engine exported are drawn
        in red: Osmix {only.Osmix.toLocaleString()}, DuckDB {only.DuckDB.toLocaleString()}.
      </p>
      <div className="maps">
        {ENGINE_NAMES.map((name) => (
          <div key={name} className="map-container">
            <div className="map-title">{name}</div>
            <MapView bbox={bbox} geojson={collections[name]} />
          </div>
        ))}
      </div>
    </section>
  );
}

const color: ExpressionSpecification = [
  "case",
  ["==", ["get", "_only"], true],
  ONLY_COLOR,
  BASE_COLOR,
];

function MapView({ bbox, geojson }: { bbox: GeoBbox2D; geojson: GeoJSON.FeatureCollection }) {
  const [entity, setEntity] = useState<{ label: string; tags: [string, string][] } | null>(null);
  return (
    <MaplibreMap
      reuseMaps={true}
      initialViewState={{ bounds: bbox }}
      mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      style={{ width: "100%", height: "100%" }}
      ref={(map: MapRef | null) => {
        if (!map) return;
        map.on("mousemove", ["ways", "nodes"], (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const { _only, ...tags } = feature.properties ?? {};
          const type = feature.layer.id === "ways" ? "way" : "node";
          setEntity({
            label: `${type}/${feature.id}${_only ? " (only this engine)" : ""}`,
            tags: Object.entries(tags).map(([key, value]) => [key, String(value)]),
          });
        });
      }}
    >
      <Source type="geojson" data={geojson}>
        <Layer
          type="line"
          paint={{ "line-color": color, "line-width": 1 }}
          filter={["==", ["geometry-type"], "LineString"]}
          id="ways"
        />
        <Layer
          type="circle"
          paint={{ "circle-color": color, "circle-radius": 2 }}
          filter={["==", ["geometry-type"], "Point"]}
          id="nodes"
        />
      </Source>
      <div className="map-inspector">
        {entity ? (
          <>
            <div>{entity.label}</div>
            <table className="map-control-table">
              <tbody>
                {entity.tags.map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div>Hover over a feature</div>
        )}
      </div>
    </MaplibreMap>
  );
}
