import { routingControlIsOpenAtom, selectedOsmAtom, type UseOsmFileReturn } from "@osmix/app-core";
import { useOsmixRemote } from "@osmix/app-core";
import { Alert, IconButton, ScrollArea, SectionTitle, Spinner } from "@osmix/ui";
import { useAtom, useAtomValue } from "jotai";
import { NavigationIcon, XIcon } from "lucide-react";
import type { Osm } from "osmix";
import type { LonLat } from "osmix";
import { bboxFromLonLats } from "osmix";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";

import { useMap } from "../hooks/map.ts";
import { routingStateAtom, type SnappedNode } from "../state/routing.ts";
import CustomControl from "./custom-control.tsx";
import { FullIndexRequired } from "./full-index-required.tsx";
import { MapPanelBody, MapPanelHeader } from "./map-panel-header.tsx";

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

/**
 * Floating routing panel. `osmFiles` are the app's loaded slots, used to offer a Full reload
 * when the selected dataset lacks the all-node index routing needs.
 */
export default function RouteMapControl({ osmFiles }: { osmFiles: readonly UseOsmFileReturn[] }) {
  const isOpen = useAtomValue(routingControlIsOpenAtom);
  const osm = useAtomValue(selectedOsmAtom);
  if (!isOpen || !osm) return null;
  if (!osm.info().spatialIndexes.nodes.all) {
    const selectedOsmFile = osmFiles.find((osmFile) => osmFile.osmInfo?.id === osm.id);
    return (
      <CustomControl position="bottom-left" width="narrow">
        <RoutingUnavailable osmFile={selectedOsmFile} />
      </CustomControl>
    );
  }
  return (
    <CustomControl position="bottom-left" width="narrow">
      <Routing osm={osm} />
    </CustomControl>
  );
}

function RoutingUnavailable({ osmFile }: { osmFile?: UseOsmFileReturn }) {
  return (
    <>
      <MapPanelHeader icon={<NavigationIcon aria-hidden="true" />} title="Routing" />
      <MapPanelBody>
        <div className="p-inset">
          {osmFile ? (
            <FullIndexRequired operation="Routing" osmFile={osmFile} />
          ) : (
            <Alert variant="warning" title="Routing unavailable">
              Routing requires the all-node spatial index. Reload this PBF using Full under Advanced
              load profile.
            </Alert>
          )}
        </div>
      </MapPanelBody>
    </>
  );
}

export function Routing({ osm }: { osm: Osm }) {
  const remote = useOsmixRemote();
  const map = useMap();
  const [routingState, setRoutingState] = useAtom(routingStateAtom);
  const clickPhaseRef = useRef<"from" | "to">("from");
  const [noNodeNearby, setNoNodeNearby] = useState(false);
  const [isRouting, setIsRouting] = useState(false);

  // Handle map click for setting from/to points
  // Routing graph builds automatically on first search if needed
  const handleMapClick = useEffectEvent(async (event: MapLayerMouseEvent) => {
    if (isRouting) return;

    const point: LonLat = [event.lngLat.lng, event.lngLat.lat];

    setIsRouting(true);
    try {
      const snapped = await remote.findNearestRoutableNode(osm.id, point, SNAP_RADIUS_M);

      if (!snapped) {
        // No routable node nearby - show feedback
        setNoNodeNearby(true);
        setTimeout(() => setNoNodeNearby(false), 2000);
        return;
      }

      setNoNodeNearby(false);

      // Get the OSM node ID from the node index
      const nodeId = osm.nodes.ids.at(snapped.nodeIndex);

      const snappedNode: SnappedNode = {
        nodeIndex: snapped.nodeIndex,
        nodeId,
        coordinates: snapped.coordinates,
        distance: snapped.distance,
      };

      if (clickPhaseRef.current === "from") {
        // Setting from point
        setRoutingState({
          fromPoint: point,
          toPoint: null,
          fromNode: snappedNode,
          toNode: null,
          result: null,
        });
        clickPhaseRef.current = "to";
      } else {
        // Setting to point and calculating route
        const fromNode = routingState.fromNode;
        if (!fromNode) {
          clickPhaseRef.current = "from";
          return;
        }

        const result = await remote.route(osm.id, fromNode.nodeIndex, snappedNode.nodeIndex, {
          includeStats: true,
          includePathInfo: true,
        });

        setRoutingState((prev) => ({
          ...prev,
          toPoint: point,
          toNode: snappedNode,
          result,
        }));
        clickPhaseRef.current = "from";

        if (result?.coordinates) {
          map?.fitBounds(bboxFromLonLats(result.coordinates), { padding: 50 });
        }
      }
    } finally {
      setIsRouting(false);
    }
  });

  // Attach/detach click handler to map
  useEffect(() => {
    if (!map) return;
    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [map]);

  const hasFrom = routingState.fromPoint !== null;
  const hasTo = routingState.toPoint !== null;
  const hasRoute = routingState.result !== null;

  const clearRoute = () => {
    // Reset click phase when routing is cleared
    clickPhaseRef.current = "from";
    setRoutingState({
      fromNode: null,
      fromPoint: null,
      toNode: null,
      toPoint: null,
      result: null,
    });
  };

  return (
    <>
      <MapPanelHeader
        icon={<NavigationIcon aria-hidden="true" />}
        title="Routing"
        actions={
          <IconButton
            onClick={clearRoute}
            label="Clear route"
            icon={<XIcon aria-hidden="true" />}
            disabled={!hasFrom || isRouting}
          />
        }
      />

      <MapPanelBody>
        <div className="flex flex-col gap-2 p-inset">
          {noNodeNearby && (
            <Alert variant="warning">No road found nearby. Click closer to a road.</Alert>
          )}

          {!hasFrom && !noNodeNearby && !isRouting && (
            <p className="text-muted-foreground">
              Click the map to set a starting point. The routing graph builds on the first search.
            </p>
          )}
          {hasFrom && !hasTo && !noNodeNearby && !isRouting && (
            <p className="text-muted-foreground">Click the map to set a destination.</p>
          )}

          {isRouting && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner />
              Calculating route…
            </div>
          )}

          {hasFrom && routingState.fromPoint && routingState.fromNode && (
            <div className="flex flex-col gap-1">
              <SectionTitle>From</SectionTitle>
              <SnappedNodeInfo point={routingState.fromPoint} node={routingState.fromNode} />
            </div>
          )}

          {hasTo && routingState.toPoint && routingState.toNode && (
            <div className="flex flex-col gap-1">
              <SectionTitle>To</SectionTitle>
              <SnappedNodeInfo point={routingState.toPoint} node={routingState.toNode} />
            </div>
          )}

          {hasTo && !hasRoute && !isRouting && (
            <Alert variant="destructive" title="No route found">
              These points are not connected by routable ways. Choose points on connected roads.
            </Alert>
          )}

          {hasRoute && routingState.result && (
            <div className="flex flex-col gap-2">
              <SectionTitle>Route</SectionTitle>
              <dl className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-muted-foreground">Distance</dt>
                  <dd className="font-mono">{formatDistance(routingState.result.distance ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Estimated time</dt>
                  <dd className="font-mono">{formatTime(routingState.result.time ?? 0)}</dd>
                </div>
              </dl>

              {routingState.result.segments && routingState.result.segments.length > 0 && (
                <>
                  <div className="text-muted-foreground">
                    Directions ({routingState.result.segments.length} segments)
                  </div>
                  <ScrollArea className="max-h-48">
                    <ol className="flex flex-col gap-2">
                      {routingState.result.segments.map((seg) => (
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
      </MapPanelBody>
    </>
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
