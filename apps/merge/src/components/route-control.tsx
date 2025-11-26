import type { Osm } from "@osmix/core"
import { buildGraph, findNearestNodeOnGraph, Router } from "@osmix/router"
import type { LonLat } from "@osmix/shared/types"
import { useAtom, useSetAtom } from "jotai"
import { NavigationIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MapLayerMouseEvent } from "react-map-gl/maplibre"
import { useMap } from "../hooks/map"
import {
	calculateRouteStats,
	clearRoutingAtom,
	routingGraphAtom,
	routingStateAtom,
	type SnappedNode,
} from "../state/routing"
import { Button } from "./ui/button"

/** Maximum distance (km) to snap click point to nearest node. */
const SNAP_RADIUS_KM = 1

/** Format distance in meters to human readable string. */
function formatDistance(meters: number): string {
	if (meters < 1000) return `${Math.round(meters)}m`
	return `${(meters / 1000).toFixed(2)}km`
}

/** Format coordinates to a readable string. */
function formatCoord(coord: LonLat): string {
	return `${coord[1].toFixed(6)}, ${coord[0].toFixed(6)}`
}

/** Format time in seconds to human readable string. */
function formatTime(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)} sec`
	const mins = Math.floor(seconds / 60)
	const secs = Math.round(seconds % 60)
	if (mins < 60) return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`
	const hours = Math.floor(mins / 60)
	const remainMins = mins % 60
	return `${hours} hr ${remainMins} min`
}

export default function RouteControl({ osm }: { osm: Osm }) {
	const map = useMap()
	const [routingState, setRoutingState] = useAtom(routingStateAtom)
	const [graphCache, setGraphCache] = useAtom(routingGraphAtom)
	const clearRouting = useSetAtom(clearRoutingAtom)
	const clickPhaseRef = useRef<"from" | "to">("from")
	const [noNodeNearby, setNoNodeNearby] = useState(false)

	// Build or retrieve cached routing graph
	const graph = useMemo(() => {
		if (graphCache?.osmId === osm.id) return graphCache.graph
		const newGraph = buildGraph(osm)
		setGraphCache({ osmId: osm.id, graph: newGraph })
		return newGraph
	}, [osm, graphCache, setGraphCache])

	// Handle map click for setting from/to points
	const handleMapClick = useCallback(
		(event: MapLayerMouseEvent) => {
			const point: LonLat = [event.lngLat.lng, event.lngLat.lat]
			const snapped = findNearestNodeOnGraph(osm, graph, point, SNAP_RADIUS_KM)

			if (!snapped) {
				// No routable node nearby - show feedback
				setNoNodeNearby(true)
				setTimeout(() => setNoNodeNearby(false), 2000)
				return
			}

			setNoNodeNearby(false)

			// Get the OSM node ID from the node index
			const nodeId = osm.nodes.ids.at(snapped.nodeIndex)

			const snappedNode: SnappedNode = {
				nodeIndex: snapped.nodeIndex,
				nodeId,
				coordinates: snapped.coordinates,
				distance: snapped.distance,
			}

			if (clickPhaseRef.current === "from") {
				// Setting from point
				setRoutingState({
					fromPoint: point,
					toPoint: null,
					fromNode: snappedNode,
					toNode: null,
					result: null,
					waySegments: [],
					turnPoints: [],
					totalDistance: 0,
					totalTime: 0,
				})
				clickPhaseRef.current = "to"
			} else {
				// Setting to point and calculating route
				const fromNode = routingState.fromNode
				if (!fromNode) {
					clickPhaseRef.current = "from"
					return
				}

				const router = new Router(osm, graph)
				const path = router.route(fromNode.nodeIndex, snappedNode.nodeIndex)

				if (path) {
					const result = router.buildResult(path)
					const { totalDistance, totalTime, waySegments, turnPoints } =
						calculateRouteStats(path, graph, osm)
					setRoutingState((prev) => ({
						...prev,
						toPoint: point,
						toNode: snappedNode,
						result,
						waySegments,
						turnPoints,
						totalDistance,
						totalTime,
					}))
				} else {
					// No route found
					setRoutingState((prev) => ({
						...prev,
						toPoint: point,
						toNode: snappedNode,
						result: null,
						waySegments: [],
						turnPoints: [],
						totalDistance: 0,
						totalTime: 0,
					}))
				}
				clickPhaseRef.current = "from"
			}
		},
		[osm, graph, routingState.fromNode, setRoutingState],
	)

	// Attach/detach click handler to map
	useEffect(() => {
		if (!map) return

		map.on("click", handleMapClick)

		return () => {
			map.off("click", handleMapClick)
		}
	}, [map, handleMapClick])

	// Reset click phase when routing is cleared
	useEffect(() => {
		if (!routingState.fromPoint) {
			clickPhaseRef.current = "from"
		}
	}, [routingState.fromPoint])

	const hasFrom = routingState.fromPoint !== null
	const hasTo = routingState.toPoint !== null
	const hasRoute = routingState.result !== null

	return (
		<div className="bg-background w-sm max-h-[50lvh] overflow-y-auto shadow rounded-sm">
			<div className="flex items-center justify-between pl-2 border-b">
				<div className="flex items-center gap-2">
					<NavigationIcon className="size-4" />
					<span className="font-bold">ROUTING</span>
				</div>

				<Button
					onClick={() => clearRouting()}
					variant="ghost"
					title="Clear route"
					size="icon"
					disabled={!hasFrom}
				>
					<XIcon />
				</Button>
			</div>

			<div className="p-3 space-y-3">
				{/* No node nearby feedback */}
				{noNodeNearby && (
					<div className="text-amber-500 font-medium">
						No road found nearby. Click closer to a road.
					</div>
				)}

				{/* Instructions */}
				{!hasFrom && !noNodeNearby && (
					<div className="text-muted-foreground">
						Click on the map to set a starting point
					</div>
				)}
				{hasFrom && !hasTo && !noNodeNearby && (
					<div className="text-muted-foreground">
						Click on the map to set a destination
					</div>
				)}

				{/* From point info */}
				{hasFrom && routingState.fromPoint && routingState.fromNode && (
					<div className="space-y-1">
						<div className="font-semibold text-red-500">From</div>
						<SnappedNodeInfo
							point={routingState.fromPoint}
							node={routingState.fromNode}
						/>
					</div>
				)}

				{/* To point info */}
				{hasTo && routingState.toPoint && routingState.toNode && (
					<div className="space-y-1">
						<div className="font-semibold text-red-500">To</div>
						<SnappedNodeInfo
							point={routingState.toPoint}
							node={routingState.toNode}
						/>
					</div>
				)}

				{/* Route result */}
				{hasTo && !hasRoute && (
					<div className="text-destructive font-semibold">
						No route found between these points
					</div>
				)}

				{hasRoute && (
					<div className="space-y-2">
						<div className="font-semibold text-blue-500">Route</div>
						<div className="grid grid-cols-2 gap-2">
							<div>
								<div className="text-muted-foreground">Distance</div>
								<div>{formatDistance(routingState.totalDistance)}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Est. Time</div>
								<div>{formatTime(routingState.totalTime)}</div>
							</div>
						</div>

						{/* Per-way breakdown */}
						{routingState.waySegments.length > 0 && (
							<div>
								<div className="text-muted-foreground mb-1">
									Directions ({routingState.waySegments.length} segments)
								</div>
								<div className="space-y-1 max-h-48 overflow-y-auto">
									{routingState.waySegments.map((seg, i) => (
										<div
											key={`${seg.wayIds[0]}-${i}`}
											className="border-l-2 border-blue-400 pl-2"
										>
											<div
												className="font-medium"
												title={`Way IDs: ${seg.wayIds.join(", ")}`}
											>
												{seg.name || `(${seg.highway})`}
											</div>
											<div className="text-muted-foreground">
												{formatDistance(seg.distance)} · {formatTime(seg.time)}
											</div>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

function SnappedNodeInfo({
	point,
	node,
}: {
	point: LonLat
	node: SnappedNode
}) {
	return (
		<div className="grid grid-cols-2 gap-2">
			<div>
				<div className="text-muted-foreground">Click</div>
				<div>{formatCoord(point)}</div>
			</div>
			<div>
				<div className="text-muted-foreground">Node</div>
				<div>
					{node.nodeId} ({formatDistance(node.distance)} away)
				</div>
			</div>
		</div>
	)
}
