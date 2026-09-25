import { useOsmixRemote } from "@osmix/app-core";
import { Alert, IconButton, ScrollArea, SectionTitle, Spinner } from "@osmix/ui";
import { useAtom, useSetAtom, useStore } from "jotai";
import { LogOutIcon, NavigationIcon, XIcon } from "lucide-react";
import type { LonLat } from "osmix";
import { bboxFromLonLats } from "osmix";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";

import { useMap } from "../hooks/map.ts";
import {
  exitRoutingModeAtom,
  initialRoutingState,
  routeResultStillApplies,
  type RoutingState,
  routingStateAtom,
  type SnappedNode,
} from "../state/routing.ts";
import { FullIndexRequired, hasFullNodeIndex } from "./full-index-required.tsx";
import type { LoadedMapDataset } from "./map-datasets.tsx";
import { useMapAnnounce } from "./map-overlay.tsx";
import { MapPanelBody, MapPanelHeader } from "./map-panel-header.tsx";
import { MAP_INSPECTOR_TITLE_SLOT } from "./map-search.tsx";

/** Maximum distance (m) to snap click point to nearest node. */
const SNAP_RADIUS_M = 1_000;

/** Format distance in meters to human readable string. */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

/** Format coordinates to a readable string. */
function formatCoord(coord: LonLat): string {
  return `${coord[1].toFixed(6)}, ${coord[0].toFixed(6)}`;
}

/** Format time in seconds to human readable string. */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours} hr ${remainMins} min`;
}

/** What the next map click does, from the routing state alone. */
function routingPhaseText(state: RoutingState): string {
  if (state.result) {
    return "Route shown. Click to start another route, or press Esc to exit routing.";
  }
  if (state.fromNode && !state.toNode) return "Click a destination. Press Esc to exit routing.";
  return "Click a start point. Press Esc to exit routing.";
}

/**
 * The inspector's route view: the routing tool for `dataset`, mounted only while the map is in
 * route mode. Map clicks snap to the nearest routable node (within `SNAP_RADIUS_M`), the second
 * click routes and fits the map to the result. Without the all-node index the body offers the
 * Full reload instead and no click handler is attached. The header's "Clear route" empties the
 * points and stays in the mode; "Exit routing" leaves it. The phase line says what the next
 * click does and is announced on every change.
 */
export function RoutingInspector({ dataset }: { dataset: LoadedMapDataset }) {
  const [routingState, setRoutingState] = useAtom(routingStateAtom);
  const exitRouting = useSetAtom(exitRoutingModeAtom);
  const routable = hasFullNodeIndex(dataset.osmInfo);
  const hasPoints = routingState.fromPoint !== null;

  return (
    <>
      <MapPanelHeader
        icon={<NavigationIcon aria-hidden="true" />}
        title={
          <span data-slot={MAP_INSPECTOR_TITLE_SLOT} tabIndex={-1}>
            Route
          </span>
        }
        detail={dataset.label}
        actions={
          <>
            <IconButton
              label="Clear route"
              icon={<XIcon aria-hidden="true" />}
              disabled={!hasPoints}
              onClick={() => setRoutingState(initialRoutingState)}
            />
            <IconButton
              label="Exit routing"
              icon={<LogOutIcon aria-hidden="true" />}
              onClick={() => exitRouting()}
            />
          </>
        }
      />
      <MapPanelBody>
        {routable ? (
          <RoutingBody dataset={dataset} />
        ) : (
          <div className="p-inset">
            <FullIndexRequired operation="Routing" osmFile={dataset.osmFile} />
          </div>
        )}
      </MapPanelBody>
    </>
  );
}

/** The click handler, cursor and results for a dataset that has the all-node index. */
function RoutingBody({ dataset }: { dataset: LoadedMapDataset }) {
  const { osm } = dataset;
  const remote = useOsmixRemote();
  const map = useMap();
  const store = useStore();
  const announce = useMapAnnounce();
  const [routingState, setRoutingState] = useAtom(routingStateAtom);
  const [noNodeNearby, setNoNodeNearby] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  // True while the click handler is attached. A click resolves asynchronously; once the tool
  // has exited nothing may write routing state or move the map.
  const activeRef = useRef(false);

  const phaseText = routingPhaseText(routingState);
  useEffect(() => {
    announce(phaseText);
  }, [announce, phaseText]);

  // The tool owns the canvas cursor while it is active; the overlay leaves it alone in route
  // mode.
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    canvas.style.setProperty("cursor", "crosshair");
    return () => {
      canvas.style.setProperty("cursor", "");
    };
  }, [map]);

  // A click sets the start point, then the destination (which routes); after a route or a
  // failed one, the next click starts over. The routing graph builds on the first search.
  // Every write after an `await` checks that the tool is still active, and a route result is
  // dropped when the start point it was computed from is gone ("Clear route" meanwhile).
  const handleMapClick = useEffectEvent(async (event: MapLayerMouseEvent) => {
    if (isRouting) return;
    const point: LonLat = [event.lngLat.lng, event.lngLat.lat];

    setIsRouting(true);
    try {
      const snapped = await remote.findNearestRoutableNode(osm.id, point, SNAP_RADIUS_M);
      if (!activeRef.current) return;
      if (!snapped) {
        setNoNodeNearby(true);
        return;
      }
      setNoNodeNearby(false);

      const snappedNode: SnappedNode = {
        nodeIndex: snapped.nodeIndex,
        nodeId: osm.nodes.ids.at(snapped.nodeIndex),
        coordinates: snapped.coordinates,
        distance: snapped.distance,
      };

      const fromNode = routingState.fromNode;
      const awaitingDestination = fromNode !== null && routingState.toNode === null;
      if (!awaitingDestination) {
        setRoutingState({
          ...initialRoutingState,
          fromPoint: point,
          fromNode: snappedNode,
          osmId: osm.id,
        });
        return;
      }

      const result = await remote.route(osm.id, fromNode.nodeIndex, snappedNode.nodeIndex, {
        includeStats: true,
        includePathInfo: true,
      });
      if (!activeRef.current || !routeResultStillApplies(store.get(routingStateAtom), fromNode)) {
        return;
      }
      setRoutingState((prev) => ({ ...prev, toPoint: point, toNode: snappedNode, result }));
      if (result?.coordinates) {
        map?.fitBounds(bboxFromLonLats(result.coordinates), { padding: 50 });
      }
    } finally {
      setIsRouting(false);
    }
  });

  useEffect(() => {
    if (!map) return;
    activeRef.current = true;
    map.on("click", handleMapClick);
    return () => {
      activeRef.current = false;
      map.off("click", handleMapClick);
    };
  }, [map]);

  useEffect(() => {
    if (!noNodeNearby) return;
    const timer = setTimeout(() => setNoNodeNearby(false), 2000);
    return () => clearTimeout(timer);
  }, [noNodeNearby]);

  const { fromPoint, fromNode, toPoint, toNode, result } = routingState;

  return (
    <div className="flex flex-col gap-2 p-inset">
      <p className="text-muted-foreground">{phaseText}</p>

      {noNodeNearby && (
        <Alert variant="warning">No road found nearby. Click closer to a road.</Alert>
      )}

      {isRouting && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          Calculating route…
        </div>
      )}

      {fromPoint && fromNode && (
        <div className="flex flex-col gap-1">
          <SectionTitle>From</SectionTitle>
          <SnappedNodeInfo point={fromPoint} node={fromNode} />
        </div>
      )}

      {toPoint && toNode && (
        <div className="flex flex-col gap-1">
          <SectionTitle>To</SectionTitle>
          <SnappedNodeInfo point={toPoint} node={toNode} />
        </div>
      )}

      {toPoint && !result && !isRouting && (
        <Alert variant="destructive" title="No route found">
          These points are not connected by routable ways. Choose points on connected roads.
        </Alert>
      )}

      {result && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Route</SectionTitle>
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-muted-foreground">Distance</dt>
              <dd className="font-mono">{formatDistance(result.distance ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Estimated time</dt>
              <dd className="font-mono">{formatTime(result.time ?? 0)}</dd>
            </div>
          </dl>

          {result.segments && result.segments.length > 0 && (
            <>
              <div className="text-muted-foreground">
                Directions ({result.segments.length} segments)
              </div>
              <ScrollArea className="max-h-48">
                <ol className="flex flex-col gap-2">
                  {result.segments.map((seg) => (
                    <li
                      key={`${seg.wayIds.join("-")}-${seg.distance}-${seg.time}`}
                      className="border-l-2 border-info/60 pl-2"
                    >
                      <div className="font-medium" title={`Way IDs: ${seg.wayIds.join(", ")}`}>
                        {seg.name || `(${seg.highway})`}
                      </div>
                      <div className="font-mono text-muted-foreground">
                        {formatDistance(seg.distance)} · {formatTime(seg.time)}
                      </div>
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SnappedNodeInfo({ point, node }: { point: LonLat; node: SnappedNode }) {
  return (
    <dl className="grid grid-cols-2 gap-2">
      <div>
        <dt className="text-muted-foreground">Click</dt>
        <dd className="font-mono">{formatCoord(point)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Node</dt>
        <dd className="font-mono">
          {node.nodeId} ({formatDistance(node.distance)} away)
        </dd>
      </div>
    </dl>
  );
}
