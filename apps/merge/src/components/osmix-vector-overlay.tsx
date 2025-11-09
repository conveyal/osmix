import type { Osmix } from "@osmix/core"
import { useSetAtom } from "jotai"
import {
	type FillLayerSpecification,
	type FilterSpecification,
	type MapLayerMouseEvent,
	Popup,
} from "maplibre-gl"
import { useCallback, useEffect, useRef } from "react"
import {
	type CircleLayerSpecification,
	Layer,
	type LineLayerSpecification,
	Source,
} from "react-map-gl/maplibre"
import { useMap } from "../hooks/map"
import { addOsmixVectorProtocol } from "../lib/osmix-vector-protocol"
import { APPID, MIN_PICKABLE_ZOOM } from "../settings"
import { selectOsmEntityAtom } from "../state/osm"

const DEFAULT_TOOLTIP_CLASS = "osmix-overlay-tooltip"

const tooltipTemplate = ({ id, type }: { id: number; type: string }) =>
	`<div class="${DEFAULT_TOOLTIP_CLASS}">${type}/${id}</div>`

if (typeof window !== "undefined") {
	addOsmixVectorProtocol()
}

const waysPaint: LineLayerSpecification["paint"] = {
	"line-color": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		["rgba", 255, 0, 0, 1],
		["rgba", 0, 0, 0, 0.15],
	],
	"line-opacity": 1,
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 2, 18, 10],
}

const waysOutlinePaint: LineLayerSpecification["paint"] = {
	"line-color": "white",
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 3, 18, 15],
}

const waysLayout: LineLayerSpecification["layout"] = {
	"line-join": "round",
}

const wayPolygonsPaint: FillLayerSpecification["paint"] = {
	"fill-color": "red",
	"fill-opacity": 0.25,
}

const wayPolygonsOutlinePaint: LineLayerSpecification["paint"] = {
	"line-color": "red",
	"line-opacity": 0.5,
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 1],
}

const relationPolygonsPaint: FillLayerSpecification["paint"] = {
	"fill-color": "blue",
	"fill-opacity": 0.25,
}

const relationPolygonsOutlinePaint: LineLayerSpecification["paint"] = {
	"line-color": "blue",
	"line-opacity": 0.5,
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 1],
}

const nodesPaint: CircleLayerSpecification["paint"] = {
	"circle-color": ["rgba", 255, 255, 255, 1],
	"circle-opacity": 1,
	"circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 3, 18, 6],
	"circle-stroke-color": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		["rgba", 255, 0, 0, 1],
		["rgba", 0, 0, 0, 0.5],
	],
	"circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 2],
}

const nodeFilter: FilterSpecification = ["==", ["get", "type"], "node"]
const wayLinesFilter: FilterSpecification = [
	"==",
	["geometry-type"],
	"LineString",
]
const wayPolygonsFilter: FilterSpecification = [
	"==",
	["geometry-type"],
	"Polygon",
]

const relationFilter: FilterSpecification = ["==", ["get", "type"], "relation"]

/**
 * Decode zigzag-encoded ID back to original value. Zigzag encoding is used to convert negative IDs to positive numbers for unsigned varint
 * encoding in vector tiles. Uses arithmetic-based decoding to support the full safe integer range.
 */
function decodeZigzag(encoded: number): number {
	// Check if encoded is odd (negative) using bitwise, then use arithmetic
	return (encoded & 1) === 1 ? -(encoded + 1) / 2 : encoded / 2
}

export default function OsmixVectorOverlay({ osm }: { osm: Osmix }) {
	const map = useMap()
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const popupRef = useRef<Popup | null>(null)

	const overlayId = `${APPID}:${osm?.id}:overlay`
	const sourceId = `${overlayId}:source`
	const waysLayerId = `${overlayId}:ways`
	const wayPolygonsLayerId = `${waysLayerId}:polygons`
	const nodesLayerId = `${overlayId}:nodes`
	const relationsLayerId = `${overlayId}:relations`
	const relationPolygonsLayerId = `${relationsLayerId}:polygons`
	const sourceLayerPrefix = `@osmix:${osm.id}`

	const clearHover = useCallback(() => {
		if (map) {
			map.getCanvas().style.setProperty("cursor", "")
			const source = map.getSource(sourceId)
			if (sourceId && source) {
				map.removeFeatureState({
					source: sourceId,
					sourceLayer: `${sourceLayerPrefix}:ways`,
				})
				map.removeFeatureState({
					source: sourceId,
					sourceLayer: `${sourceLayerPrefix}:nodes`,
				})
				map.removeFeatureState({
					source: sourceId,
					sourceLayer: `${sourceLayerPrefix}:relations`,
				})
			}
		}

		popupRef.current?.remove()
	}, [map, sourceId, sourceLayerPrefix])

	const handleClick = useCallback(
		(event: MapLayerMouseEvent) => {
			const feature = event.features?.[0]
			if (!osm || !feature || typeof feature.id !== "number") {
				selectEntity(null, null)
				return
			}
			// Decode zigzag-encoded ID if it was originally negative
			const decodedId = decodeZigzag(feature.id)
			if (feature.properties?.type === "node") {
				selectEntity(osm, osm.nodes.getById(decodedId))
			} else if (feature.properties?.type === "way") {
				selectEntity(osm, osm.ways.getById(decodedId))
			} else if (feature.properties?.type === "relation") {
				selectEntity(osm, osm.relations.getById(decodedId))
			} else {
				selectEntity(osm, null)
			}
		},
		[osm, selectEntity, osm.nodes, osm.ways, osm.relations],
	)

	const handleMove = useCallback(
		(event: MapLayerMouseEvent) => {
			if (!map || !sourceId) return
			const feature = event.features?.[0]
			if (!feature || typeof feature.id !== "number") {
				clearHover()
				return
			}
			map.getCanvas().style.setProperty("cursor", "pointer")
			if (!popupRef.current) {
				popupRef.current = new Popup({
					closeButton: false,
					closeOnClick: false,
					className: "osmix-overlay-popup",
				})
			}
			const fs = map.getFeatureState({
				source: feature.source,
				sourceLayer: feature.sourceLayer,
				id: feature.id,
			})
			if (!fs.hover) {
				const featureType = feature.properties?.type || "unknown"
				// Decode zigzag-encoded ID if it was originally negative
				const decodedId = decodeZigzag(feature.id)
				popupRef
					.current!.setLngLat(event.lngLat)
					.setHTML(tooltipTemplate({ id: decodedId, type: featureType }))
					.addTo(map.getMap())
				map.removeFeatureState({
					source: feature.source,
					sourceLayer: feature.sourceLayer,
				})
				map.setFeatureState(
					{
						source: feature.source,
						sourceLayer: feature.sourceLayer,
						id: feature.id,
					},
					{ hover: true },
				)
			}
		},
		[clearHover, map, sourceId],
	)

	const handleLeave = useCallback(() => {
		clearHover()
	}, [clearHover])

	useEffect(() => {
		if (!map) return
		let attached = false

		const layerIds = [
			nodesLayerId,
			waysLayerId,
			wayPolygonsLayerId,
			relationPolygonsLayerId,
		]
		const attachHandlers = () => {
			if (attached) return
			if (
				!map.getLayer(nodesLayerId) ||
				!map.getLayer(waysLayerId) ||
				!map.getLayer(wayPolygonsLayerId) ||
				!map.getLayer(relationPolygonsLayerId)
			)
				return
			map.on("click", layerIds, handleClick)
			map.on("mousemove", layerIds, handleMove)
			map.on("mouseleave", layerIds, handleLeave)
			attached = true
		}

		attachHandlers()
		const onStyleData = () => attachHandlers()
		map.on("styledata", onStyleData)

		return () => {
			map.off("styledata", onStyleData)
			if (attached) {
				map.off("click", layerIds, handleClick)
				map.off("mousemove", layerIds, handleMove)
				map.off("mouseleave", layerIds, handleLeave)
			}
			clearHover()
		}
	}, [
		clearHover,
		handleClick,
		handleLeave,
		handleMove,
		map,
		nodesLayerId,
		waysLayerId,
		wayPolygonsLayerId,
		relationPolygonsLayerId,
	])

	return (
		<Source
			id={sourceId}
			type="vector"
			tiles={[`@osmix/vector://${osm.id}/{z}/{x}/{y}.mvt`]}
			bounds={osm.bbox()}
			minzoom={MIN_PICKABLE_ZOOM}
		>
			{/* Polygon fills - rendered first (behind everything) */}
			<Layer
				id={relationPolygonsLayerId}
				filter={relationFilter}
				type="fill"
				{...{ "source-layer": `${sourceLayerPrefix}:relations` }}
				paint={relationPolygonsPaint}
			/>
			<Layer
				id={`${relationPolygonsLayerId}:outline`}
				filter={relationFilter}
				type="line"
				{...{ "source-layer": `${sourceLayerPrefix}:relations` }}
				paint={relationPolygonsOutlinePaint}
			/>
			<Layer
				id={wayPolygonsLayerId}
				filter={wayPolygonsFilter}
				type="fill"
				{...{ "source-layer": `${sourceLayerPrefix}:ways` }}
				paint={wayPolygonsPaint}
			/>
			<Layer
				id={`${wayPolygonsLayerId}:outline`}
				filter={wayPolygonsFilter}
				type="line"
				{...{ "source-layer": `${sourceLayerPrefix}:ways` }}
				paint={wayPolygonsOutlinePaint}
			/>
			{/* Way lines - rendered on top of polygon fills */}
			<Layer
				id={`${waysLayerId}:outline`}
				filter={wayLinesFilter}
				type="line"
				{...{ "source-layer": `${sourceLayerPrefix}:ways` }}
				layout={waysLayout}
				paint={waysOutlinePaint}
			/>
			<Layer
				id={waysLayerId}
				filter={wayLinesFilter}
				type="line"
				{...{ "source-layer": `${sourceLayerPrefix}:ways` }}
				layout={waysLayout}
				paint={waysPaint}
			/>
			{/* Nodes - rendered on top of lines */}
			<Layer
				id={nodesLayerId}
				filter={nodeFilter}
				type="circle"
				{...{ "source-layer": `${sourceLayerPrefix}:nodes` }}
				paint={nodesPaint}
			/>
		</Source>
	)
}
