import type { Osm, OsmInfo } from "@osmix/core"
import type { OsmEntity } from "@osmix/shared/types"
import { isNode, isRelation, isWay } from "@osmix/shared/utils"
import { useCallback } from "react"
import { useMap as useMapCollection } from "react-map-gl/maplibre"

export function useMap() {
	const mapCollection = useMapCollection()

	return mapCollection.default ?? mapCollection.current ?? null
}

export function useFlyToEntity() {
	const map = useMap()

	return useCallback(
		(osm: Osm, entity: OsmEntity) => {
			if (!map) return
			if (isNode(entity)) {
				map.flyTo({
					center: [entity.lon, entity.lat],
					padding: 200,
					maxDuration: 200,
					zoom: 16,
				})
			} else if (isWay(entity)) {
				const bbox = osm.ways.getBbox({ id: entity.id })
				map.fitBounds(bbox, {
					padding: 100,
					maxDuration: 200,
				})
			} else if (isRelation(entity)) {
				const bbox = osm.relations.getBbox({ id: entity.id })
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
		(osmInfo?: OsmInfo) => {
			const bbox = osmInfo?.bbox
			if (!map || !bbox) return
			map.fitBounds(bbox, {
				padding: 100,
				maxDuration: 200,
			})
		},
		[map],
	)
}
