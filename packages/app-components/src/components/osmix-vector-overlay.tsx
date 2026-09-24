import { selectOsmEntityAtom } from "@osmix/app-core";
import { useSetAtom } from "jotai";
import {
  type ExpressionSpecification,
  type FillLayerSpecification,
  type FilterSpecification,
  type MapLayerMouseEvent,
  Popup,
} from "maplibre-gl";
import type { Osm } from "osmix";
import { decodeZigzag } from "osmix";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import {
  type CircleLayerSpecification,
  Layer,
  type LineLayerSpecification,
  Source,
} from "react-map-gl/maplibre";

import { APPID, MIN_PICKABLE_ZOOM } from "../constants.ts";
import { type MapColors, useMapColors } from "../hooks/map-colors.ts";
import { useMap } from "../hooks/map.ts";
import { osmixIdToTileUrl } from "../lib/osmix-vector-protocol.ts";

const DEFAULT_TOOLTIP_CLASS = "osmix-overlay-tooltip";

const tooltipTemplate = ({ id, type }: { id: number; type: string }) =>
  `<div class="${DEFAULT_TOOLTIP_CLASS}">${type}/${id}</div>`;

/** Which dataset an overlay draws: the base dataset or a patch being merged into it. */
export type OsmixOverlayRole = "base" | "patch";

const isHovered: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

/** A feature's own `color` property when present, otherwise the dataset color. */
function featureColor(fallback: string): ExpressionSpecification {
  return ["case", ["has", "color"], ["to-color", ["get", "color"]], fallback];
}

const outlineWidth: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 1];

/** Layer paint for an overlay, colored by dataset role (see `useMapColors`). */
function overlayPaints(colors: MapColors, role: OsmixOverlayRole) {
  const color = colors[role];
  const ways: LineLayerSpecification["paint"] = {
    "line-color": ["case", isHovered, colors.hover, featureColor(color)],
    "line-opacity": 1,
    "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 2, 18, 10],
  };
  const wayPolygons: FillLayerSpecification["paint"] = {
    "fill-color": ["case", isHovered, colors.hover, featureColor(color)],
    "fill-opacity": 0.25,
  };
  const wayPolygonsOutline: LineLayerSpecification["paint"] = {
    "line-color": featureColor(color),
    "line-opacity": 0.5,
    "line-width": outlineWidth,
  };
  const relationPolygons: FillLayerSpecification["paint"] = {
    "fill-color": ["case", isHovered, colors.hover, color],
    "fill-opacity": 0.25,
  };
  const relationPolygonsOutline: LineLayerSpecification["paint"] = {
    "line-color": color,
    "line-opacity": 0.5,
    "line-width": outlineWidth,
  };
  const nodes: CircleLayerSpecification["paint"] = {
    "circle-color": ["case", isHovered, colors.hover, color],
    "circle-opacity": 1,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 3, 18, 6],
    "circle-stroke-color": colors.casing,
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 2],
  };
  return {
    ways,
    wayPolygons,
    wayPolygonsOutline,
    relationPolygons,
    relationPolygonsOutline,
    nodes,
  };
}

const waysLayout: LineLayerSpecification["layout"] = {
  "line-join": "round",
};

const nodeFilter: FilterSpecification = ["==", ["get", "type"], "node"];
const wayLinesFilter: FilterSpecification = ["==", ["geometry-type"], "LineString"];
const wayPolygonsFilter: FilterSpecification = ["==", ["geometry-type"], "Polygon"];

const relationFilter: FilterSpecification = ["==", ["get", "type"], "relation"];

/**
 * Interactive vector overlay for one dataset: hover tooltips and click-to-select. `role` picks
 * the dataset color; a feature's own `color` property wins.
 */
export default function OsmixVectorOverlay({
  osm,
  role = "base",
}: {
  osm: Osm;
  role?: OsmixOverlayRole;
}) {
  const map = useMap();
  const colors = useMapColors();
  const paints = useMemo(() => overlayPaints(colors, role), [colors, role]);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const popupRef = useRef<Popup | null>(null);

  const overlayId = `${APPID}:${osm?.id}:overlay`;
  const sourceId = `${overlayId}:source`;
  const waysLayerId = `${overlayId}:ways`;
  const wayPolygonsLayerId = `${waysLayerId}:polygons`;
  const nodesLayerId = `${overlayId}:nodes`;
  const relationsLayerId = `${overlayId}:relations`;
  const relationPolygonsLayerId = `${relationsLayerId}:polygons`;
  const sourceLayerPrefix = `@osmix:${osm.id}`;

  const clearHover = useEffectEvent(() => {
    if (map) {
      map.getCanvas().style.setProperty("cursor", "");
      const source = map.getSource(sourceId);
      if (sourceId && source) {
        map.removeFeatureState({
          source: sourceId,
          sourceLayer: `${sourceLayerPrefix}:ways`,
        });
        map.removeFeatureState({
          source: sourceId,
          sourceLayer: `${sourceLayerPrefix}:nodes`,
        });
        map.removeFeatureState({
          source: sourceId,
          sourceLayer: `${sourceLayerPrefix}:relations`,
        });
      }
    }

    popupRef.current?.remove();
  });

  const handleClick = useEffectEvent(async (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!osm || !feature || typeof feature.id !== "number") {
      selectEntity(null, null);
      return;
    }
    // Decode zigzag-encoded ID if it was originally negative
    const decodedId = decodeZigzag(feature.id);
    if (feature.properties?.type === "node") {
      selectEntity(osm, osm.nodes.getById(decodedId));
    } else if (feature.properties?.type === "way") {
      selectEntity(osm, osm.ways.getById(decodedId));
    } else if (feature.properties?.type === "relation") {
      selectEntity(osm, osm.relations.getById(decodedId));
    } else {
      selectEntity(osm, null);
    }
  });

  const handleMove = useEffectEvent((event: MapLayerMouseEvent) => {
    if (!map || !sourceId) return;
    const feature = event.features?.[0];
    if (!feature || typeof feature.id !== "number") {
      clearHover();
      return;
    }
    map.getCanvas().style.setProperty("cursor", "pointer");
    if (!popupRef.current) {
      popupRef.current = new Popup({
        closeButton: false,
        closeOnClick: false,
        className: "osmix-overlay-popup",
      });
    }
    const fs = map.getFeatureState({
      source: feature.source,
      sourceLayer: feature.sourceLayer,
      id: feature.id,
    });
    if (!fs.hover) {
      const featureType = feature.properties?.type || "unknown";
      // Decode zigzag-encoded ID if it was originally negative
      const decodedId = decodeZigzag(feature.id);
      popupRef
        .current!.setLngLat(event.lngLat)
        .setHTML(tooltipTemplate({ id: decodedId, type: featureType }))
        .addTo(map.getMap());
      map.removeFeatureState({
        source: feature.source,
        sourceLayer: feature.sourceLayer,
      });
      map.setFeatureState(
        {
          source: feature.source,
          sourceLayer: feature.sourceLayer,
          id: feature.id,
        },
        { hover: true },
      );
    }
  });

  const handleLeave = useEffectEvent(() => {
    clearHover();
  });

  useEffect(() => {
    if (!map) return;
    let attached = false;

    const layerIds = [nodesLayerId, waysLayerId, wayPolygonsLayerId, relationPolygonsLayerId];
    const attachHandlers = () => {
      if (attached) return;
      if (
        !map.getLayer(nodesLayerId) ||
        !map.getLayer(waysLayerId) ||
        !map.getLayer(wayPolygonsLayerId) ||
        !map.getLayer(relationPolygonsLayerId)
      )
        return;
      map.on("click", layerIds, handleClick);
      map.on("mousemove", layerIds, handleMove);
      map.on("mouseleave", layerIds, handleLeave);
      attached = true;
    };

    attachHandlers();
    const onStyleData = () => attachHandlers();
    map.on("styledata", onStyleData);

    return () => {
      map.off("styledata", onStyleData);
      if (attached) {
        map.off("click", layerIds, handleClick);
        map.off("mousemove", layerIds, handleMove);
        map.off("mouseleave", layerIds, handleLeave);
      }
      clearHover();
    };
  }, [map, nodesLayerId, waysLayerId, wayPolygonsLayerId, relationPolygonsLayerId]);

  return (
    <Source
      key={sourceId}
      id={sourceId}
      type="vector"
      tiles={[osmixIdToTileUrl(osm.id)]}
      bounds={osm.bbox()}
      minzoom={MIN_PICKABLE_ZOOM}
    >
      {/* Polygon fills - rendered first (behind everything) */}
      <Layer
        id={relationPolygonsLayerId}
        filter={relationFilter}
        type="fill"
        {...{ "source-layer": `${sourceLayerPrefix}:relations` }}
        paint={paints.relationPolygons}
      />
      <Layer
        id={`${relationPolygonsLayerId}:outline`}
        filter={relationFilter}
        type="line"
        {...{ "source-layer": `${sourceLayerPrefix}:relations` }}
        paint={paints.relationPolygonsOutline}
      />
      <Layer
        id={wayPolygonsLayerId}
        filter={wayPolygonsFilter}
        type="fill"
        {...{ "source-layer": `${sourceLayerPrefix}:ways` }}
        paint={paints.wayPolygons}
      />
      <Layer
        id={`${wayPolygonsLayerId}:outline`}
        filter={wayPolygonsFilter}
        type="line"
        {...{ "source-layer": `${sourceLayerPrefix}:ways` }}
        paint={paints.wayPolygonsOutline}
      />
      {/* Way lines - rendered on top of polygon fills */}
      <Layer
        id={waysLayerId}
        filter={wayLinesFilter}
        type="line"
        {...{ "source-layer": `${sourceLayerPrefix}:ways` }}
        layout={waysLayout}
        paint={paints.ways}
      />
      {/* Nodes - rendered on top of lines */}
      <Layer
        id={nodesLayerId}
        filter={nodeFilter}
        type="circle"
        {...{ "source-layer": `${sourceLayerPrefix}:nodes` }}
        paint={paints.nodes}
      />
    </Source>
  );
}
