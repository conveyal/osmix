import type { Osmix } from "@osmix/core"
import { isNode, type OsmEntity } from "@osmix/json"
import { useCallback } from "react"
import { useMap as useMapCollection } from "react-map-gl/maplibre"

export function useMap() {
	const mapCollection = useMapCollection()

	return mapCollection.default ?? mapCollection.current ?? null
}

export function useFlyToEntity() {
	const map = useMap()

	return useCallback(
		(osm: Osmix, entity: OsmEntity) => {
			if (!map) return
			if (isNode(entity)) {
				map.flyTo({
					center: [entity.lon, entity.lat],
					padding: 200,
					maxDuration: 200,
					zoom: 16,
				})
			} else {
				const bbox = osm.getEntityBbox(entity)
				map.fitBounds(bbox, {
					padding: 100,
					maxDuration: 200,
				})
			}
		},
		[map],
	)
}

export function useFlyToOsmBounds() {
	const map = useMap()

	return useCallback(
		(osm?: Osmix) => {
			const bbox = osm?.bbox()
			if (!map || !bbox) return
			map.fitBounds(bbox, {
				padding: 100,
				maxDuration: 200,
			})
		},
		[map],
	)
}
