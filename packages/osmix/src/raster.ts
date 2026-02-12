/**
 * Raster tile rendering from OSM indexes.
 *
 * Provides default rendering logic that draws relations, ways, and nodes
 * onto raster tiles with appropriate styling based on geometry type.
 *
 * @module
 */

import type { Osm } from "@osmix/core"
import {
	DEFAULT_AREA_COLOR,
	DEFAULT_LINE_COLOR,
	DEFAULT_RASTER_TILE_SIZE,
	OsmixRasterTile,
} from "@osmix/raster"
import { hexColorToRgba } from "@osmix/shared/color"
import type { Rgba, Tile } from "@osmix/shared/types"
import { wayIsArea } from "@osmix/shared/way-is-area"

export interface DrawToRasterTileOptions {
	tileSize?: number
	areaColor?: Rgba
	lineColor?: Rgba
	pointColor?: Rgba
}

/**
 * Draw an Osm index into a raster tile using default rendering logic.
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
export function drawToRasterTile(
	osm: Osm,
	tile: Tile,
	opts?: DrawToRasterTileOptions
) {
	const tileSize = opts?.tileSize ?? DEFAULT_RASTER_TILE_SIZE
	const rasterTile = new OsmixRasterTile({ tile, tileSize })
	const bbox = rasterTile.bbox()

	// Get way IDs that are part of relations (to exclude from individual rendering)
	const relationWayIds = osm.relations.getWayMemberIds()

	// Draw relations by kind
	osm.relations.intersects(bbox, (relIndex) => {
		// Try fast path: check if relation bbox fits in a single pixel
		const relationBbox = osm.relations.getEntityBbox({ index: relIndex })
		if (rasterTile.drawSubpixelEntity(relationBbox, opts?.areaColor ?? DEFAULT_AREA_COLOR))
			return false

		const geometry = osm.relations.getRelationGeometry(relIndex)
		if (!geometry) return false

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
				rasterTile.drawPoint(point)
			}
		}
		return false
	})

	// Draw ways (excluding those that are part of relations)
	osm.ways.intersects(bbox, (wayIndex) => {
		if (relationWayIds.has(osm.ways.ids.at(wayIndex))) return false
		const way = osm.ways.getByIndex(wayIndex)
		const tagColor = hexColorToRgba(way.tags?.["color"] ?? way.tags?.["colour"])
		const lineColor: Rgba = tagColor
			? [tagColor[0], tagColor[1], tagColor[2], DEFAULT_LINE_COLOR[3]]
			: opts?.lineColor ?? DEFAULT_LINE_COLOR
		const areaColor: Rgba = tagColor
			? [tagColor[0], tagColor[1], tagColor[2], DEFAULT_AREA_COLOR[3]]
			: opts?.areaColor ?? DEFAULT_AREA_COLOR

		// Try fast path: check if way bbox fits in a single pixel
		const wayBbox = osm.ways.getEntityBbox({ index: wayIndex })
		const isArea = wayIsArea(way)
		const wayColor: Rgba = isArea ? areaColor : lineColor

		// Try fast path for way
		if (rasterTile.drawSubpixelEntity(wayBbox, wayColor)) return false

		// Fall back to full geometry rendering
		const coords = osm.ways.getCoordinates(wayIndex)
		if (isArea) {
			rasterTile.drawPolygon([coords], areaColor)
		} else {
			rasterTile.drawLineString(coords, lineColor)
		}
		return false
	})

	return rasterTile
}
