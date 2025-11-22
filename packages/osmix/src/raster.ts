import type { Osm } from "@osmix/core"
import {
	DEFAULT_AREA_COLOR,
	DEFAULT_LINE_COLOR,
	type OsmixRasterTile,
} from "@osmix/raster"
import type { Rgba } from "@osmix/shared/types"
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
		// Try fast path: check if relation bbox fits in a single pixel
		const relationBbox = osm.relations.getEntityBbox({ index: relIndex })
		if (rasterTile.drawSubpixelEntity(relationBbox, DEFAULT_AREA_COLOR))
			continue

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
	osm.ways.intersects(bbox, (wayIndex) => {
		if (relationWayIds.has(osm.ways.ids.at(wayIndex))) return false
		const way = osm.ways.getByIndex(wayIndex)

		// Try fast path: check if way bbox fits in a single pixel
		const wayBbox = osm.ways.getEntityBbox({ index: wayIndex })
		const isArea = wayIsArea(way)
		const wayColor: Rgba = isArea ? [255, 0, 0, 64] : DEFAULT_LINE_COLOR

		// Try fast path for way
		if (rasterTile.drawSubpixelEntity(wayBbox, wayColor)) return false

		// Fall back to full geometry rendering
		const coords = osm.ways.getCoordinates(wayIndex)
		if (isArea) {
			rasterTile.drawPolygon([coords], [255, 0, 0, 64])
		} else {
			rasterTile.drawLineString(coords)
		}
		return false
	})

	/* for (const wayIndex of wayIndexes) {
		const way = osm.ways.getByIndex(wayIndex)

		// Try fast path: check if way bbox fits in a single pixel
		const wayBbox = osm.ways.getEntityBbox({ index: wayIndex })
		const isArea = wayIsArea(way)
		const wayColor: Rgba = isArea ? [255, 0, 0, 64] : DEFAULT_LINE_COLOR

		// Try fast path for way
		if (rasterTile.drawSubpixelEntity(wayBbox, wayColor)) continue

		// Fall back to full geometry rendering
		const coords = osm.ways.getCoordinates(wayIndex)
		if (isArea) {
			rasterTile.drawPolygon([coords], [255, 0, 0, 64])
		} else {
			rasterTile.drawLineString(coords)
		}
	}*/
	console.timeEnd(timer)

	return rasterTile
}
