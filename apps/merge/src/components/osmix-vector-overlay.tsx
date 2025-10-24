import type { Osmix } from "@osmix/core"
import { useSetAtom } from "jotai"
import {
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
const wayFilter: FilterSpecification = ["==", ["get", "type"], "way"]

export default function OsmixVectorOverlay({ osm }: { osm: Osmix }) {
	const map = useMap()
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const popupRef = useRef<Popup | null>(null)

	const overlayId = `${APPID}:${osm?.id}:overlay`
	const sourceId = `${overlayId}:source`
	const waysLayerId = `${overlayId}:ways`
	const nodesLayerId = `${overlayId}:nodes`

	const clearHover = useCallback(() => {
		if (map) {
			map.getCanvas().style.setProperty("cursor", "")
			const source = map.getSource(sourceId)
			if (sourceId && source) {
				map.removeFeatureState({ source: sourceId, sourceLayer: "osmix:ways" })
				map.removeFeatureState({ source: sourceId, sourceLayer: "osmix:nodes" })
			}
		}

		popupRef.current?.remove()
	}, [map, sourceId])

	const handleClick = useCallback(
		(event: MapLayerMouseEvent) => {
			const feature = event.features?.[0]
			if (!osm || !feature || typeof feature.id !== "number") {
				selectEntity(null, null)
				return
			}
			if (feature.properties?.type === "node") {
				selectEntity(osm, osm.nodes.getById(feature.id))
			} else if (feature.properties?.type === "way") {
				selectEntity(osm, osm.ways.getById(feature.id))
			} else {
				selectEntity(osm, null)
			}
		},
		[osm, selectEntity, osm.nodes, osm.ways],
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
				popupRef
					.current!.setLngLat(event.lngLat)
					.setHTML(
						tooltipTemplate({ id: feature.id, type: feature.properties?.type }),
					)
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

		const layerIds = [nodesLayerId, waysLayerId]
		const attachHandlers = () => {
			if (attached) return
			if (!map.getLayer(nodesLayerId) || !map.getLayer(waysLayerId)) return
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
	])

	return (
		<Source
			id={sourceId}
			type="vector"
			tiles={[`@osmix/vector://${osm.id}/{z}/{x}/{y}.mvt`]}
		>
			<Layer
				id={`${waysLayerId}:outline`}
				filter={wayFilter}
				type="line"
				{...{ "source-layer": "osmix:ways" }}
				layout={waysLayout}
				paint={waysOutlinePaint}
				minzoom={MIN_PICKABLE_ZOOM}
			/>
			<Layer
				id={waysLayerId}
				filter={wayFilter}
				type="line"
				{...{ "source-layer": "osmix:ways" }}
				layout={waysLayout}
				paint={waysPaint}
				minzoom={MIN_PICKABLE_ZOOM}
			/>
			<Layer
				id={nodesLayerId}
				filter={nodeFilter}
				type="circle"
				{...{ "source-layer": "osmix:nodes" }}
				paint={nodesPaint}
				minzoom={MIN_PICKABLE_ZOOM}
			/>
		</Source>
	)
}
