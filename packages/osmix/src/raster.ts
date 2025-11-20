import type { Osm } from "@osmix/core"
import type { OsmixRasterTile } from "@osmix/raster"
import type { LonLat } from "@osmix/shared/types"
import { wayIsArea } from "@osmix/shared/way-is-area"

/**
 * Draw an OSM dataset into a raster tile using default rendering logic.
 *
 * Renders relations by kind:
 * - Area relations (multipolygon, boundary): as filled polygons
 * - Line relations (route, multilinestring): as line strings
 * - Point relations (multipoint): as points
 * - Logical relations (restriction, etc.): skipped
 * - Super-relations: expanded to render child relation geometry
 *
 * Also renders way polygons (filled areas) and way lines onto the tile.
 * Ways that are members of relations are excluded from individual rendering to avoid duplicates.
 *
 * For custom colors or rendering logic, use the OsmixRasterTile class directly.
 */
export function drawRasterTile(osm: Osm, rasterTile: OsmixRasterTile) {
	const tileKey = rasterTile.tile.join("/")
	const bbox = rasterTile.bbox()

	// Get way IDs that are part of relations (to exclude from individual rendering)
	const relationWayIds = osm.relations.getWayMemberIds()

	// Draw relations by kind
	const relationTimer = `OsmixRasterTile.drawRelations:${tileKey}`
	console.time(relationTimer)
	const relationIndexes = osm.relations.intersects(bbox)

	for (const relIndex of relationIndexes) {
		const relation = osm.relations.getByIndex(relIndex)
		if (!relation) continue

		const geometry = osm.relations.getRelationGeometry(relIndex)
		if (!geometry) continue

		if (geometry.rings) {
			// Area relations (multipolygon, boundary)
			rasterTile.drawMultiPolygon(geometry.rings)
		} else if (geometry.lineStrings) {
			// Line relations (route, multilinestring)
			for (const lineString of geometry.lineStrings) {
				rasterTile.drawLineString(lineString)
			}
		} else if (geometry.points) {
			// Point relations (multipoint)
			for (const point of geometry.points) {
				rasterTile.setLonLat(point)
			}
		}
	}
	console.timeEnd(relationTimer)

	// Draw ways (excluding those that are part of relations)
	const timer = `OsmixRasterTile.drawWays:${tileKey}`
	console.time(timer)
	const wayIndexes = osm.ways.intersects(bbox, (wayIndex) => {
		if (relationWayIds.has(osm.ways.ids.at(wayIndex))) return false
		return true
	})
	const ways = wayIndexes.map((wayIndex) => ({
		coords: osm.ways.getCoordinates(wayIndex),
		isArea: wayIsArea(osm.ways.getByIndex(wayIndex)),
	}))
	const { wayLines, wayPolygons } = ways.reduce(
		(acc, way) => {
			if (way.isArea) acc.wayPolygons.push(way)
			else acc.wayLines.push(way)
			return acc
		},
		{
			wayLines: [] as { coords: LonLat[]; isArea: boolean }[],
			wayPolygons: [] as { coords: LonLat[]; isArea: boolean }[],
		},
	)
	for (const way of wayPolygons) {
		rasterTile.drawPolygon([way.coords], [255, 0, 0, 64])
	}
	for (const way of wayLines) {
		rasterTile.drawLineString(way.coords)
	}
	console.timeEnd(timer)

	return rasterTile
}
