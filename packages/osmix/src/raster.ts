import type { Osm } from "@osmix/core"
import { buildRelationRings } from "@osmix/json"
import { DEFAULT_RASTER_TILE_SIZE, OsmixRasterTile } from "@osmix/raster"
import type { LonLat, Tile } from "@osmix/shared/types"
import { isMultipolygonRelation } from "@osmix/shared/utils"
import { wayIsArea } from "@osmix/shared/way-is-area"

/**
 * Draw an OSM dataset into a raster tile.
 *
 * If you need to change colors or change what is drawn you can use the `OsmixRasterTile` class directly.
 */
export function drawRasterTile(
	osm: Osm,
	tile: Tile,
	tileSize = DEFAULT_RASTER_TILE_SIZE,
) {
	const rasterTile = new OsmixRasterTile(tile, tileSize)
	const bbox = rasterTile.bbox()

	// Get way IDs that are part of relations (to exclude from individual rendering)
	const relationWayIds = osm.relations.getWayMemberIds()

	// Draw relations (multipolygon relations)
	const relationTimer = `OsmixRasterTile.drawRelations:${tile[2]}/${tile[0]}/${tile[1]}`
	console.time(relationTimer)
	const relationIndexes = osm.relations.intersects(bbox)

	for (const relIndex of relationIndexes) {
		const relation = osm.relations.getByIndex(relIndex)
		if (!isMultipolygonRelation(relation)) continue

		const getWay = (wayId: number) => osm.ways.getById(wayId)
		const getNodeCoordinates = (nodeId: number): LonLat | undefined => {
			const ll = osm.nodes.getNodeLonLat({ id: nodeId })
			return ll ? [ll[0], ll[1]] : undefined
		}

		const rings = buildRelationRings(relation, getWay, getNodeCoordinates)
		if (rings.length > 0) {
			rasterTile.drawMultiPolygon(rings)
		}
	}
	console.timeEnd(relationTimer)

	// Draw ways (excluding those that are part of relations)
	const timer = `OsmixRasterTile.drawWays:${tile[2]}/${tile[0]}/${tile[1]}`
	console.time(timer)
	const wayIndexes = osm.ways.intersects(bbox, (wayIndex) => {
		if (relationWayIds.has(osm.ways.ids.at(wayIndex))) return false
		return true
	})
	const ways = wayIndexes.map((wayIndex) => ({
		coords: osm.ways.getCoordinates(wayIndex, osm.nodes),
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

	const data = rasterTile.imageData
	if (!data || data.byteLength === 0) return new ArrayBuffer(0)
	return data.buffer
}
