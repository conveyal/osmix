import { geojsonRbush, lineIntersect } from "@turf/turf"
import type { Osm } from "./osm"
import { wayToLineString } from "./to-geojson"

export class WaySpatialIndex {
	index = geojsonRbush()
	constructor(osm: Osm) {
		const ways = Array.from(osm.ways.values()).map((w) =>
			wayToLineString(w, (r) => osm.nodes.getNodePosition(r)),
		)
		this.index.load(ways)
	}

	findIntersectingWayIds(
		way: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon>,
	) {
		const intersectingWays = this.index.search(way)
		const intersectingIds = new Set<number>()

		for (const feature of intersectingWays.features) {
			if (feature.id !== way.id && typeof feature.id === "number") {
				intersectingIds.add(feature.id)
			}
		}

		return Array.from(intersectingIds)
	}

	findIntersectingPoints(
		way1: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon>,
		way2: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon>,
	) {
		const intersectingPoints = lineIntersect(way1, way2)
		return intersectingPoints.features
	}
}
