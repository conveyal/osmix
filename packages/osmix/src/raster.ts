import type { Osm } from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE, OsmixRasterTile } from "@osmix/raster"
import { buildRelationRings } from "@osmix/shared/relation-multipolygon"
import type { LonLat, Tile } from "@osmix/shared/types"
import { isMultipolygonRelation } from "@osmix/shared/utils"
import { wayIsArea } from "@osmix/shared/way-is-area"

export class OsmixRasterEncoder {
	osm: Osm

	constructor(osm: Osm) {
		this.osm = osm
	}

	createTile(tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		return new OsmixRasterTile({ tile, tileSize })
	}

	/**
	 * Draw an OSM dataset into a raster tile.
	 *
	 * If you need to change colors or change what is drawn you can use the `OsmixRasterTile` class directly.
	 */
	drawTile(tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		const rasterTile = this.createTile(tile, tileSize)
		const tileKey = rasterTile.tile.join("/")
		const bbox = rasterTile.bbox()

		// Get way IDs that are part of relations (to exclude from individual rendering)
		const relationWayIds = this.osm.relations.getWayMemberIds()

		// Draw relations (multipolygon relations)
		const relationTimer = `OsmixRasterEncoder.drawRelations:${tileKey}`
		console.time(relationTimer)
		const relationIndexes = this.osm.relations.intersects(bbox)

		for (const relIndex of relationIndexes) {
			const relation = this.osm.relations.getByIndex(relIndex)
			if (!isMultipolygonRelation(relation)) continue

			const getWay = (wayId: number) => this.osm.ways.getById(wayId)
			const getNodeCoordinates = (nodeId: number): LonLat | undefined => {
				const ll = this.osm.nodes.getNodeLonLat({ id: nodeId })
				return ll ? [ll[0], ll[1]] : undefined
			}

			const rings = buildRelationRings(relation, getWay, getNodeCoordinates)
			if (rings.length > 0) {
				rasterTile.drawMultiPolygon(rings)
			}
		}
		console.timeEnd(relationTimer)

		// Draw ways (excluding those that are part of relations)
		const timer = `OsmixRasterEncoder.drawWays:${tileKey}`
		console.time(timer)
		const wayIndexes = this.osm.ways.intersects(bbox, (wayIndex) => {
			if (relationWayIds.has(this.osm.ways.ids.at(wayIndex))) return false
			return true
		})
		const ways = wayIndexes.map((wayIndex) => ({
			coords: this.osm.ways.getCoordinates(wayIndex, this.osm.nodes),
			isArea: wayIsArea(this.osm.ways.getByIndex(wayIndex)),
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
}

/**
 * Draw an OSM dataset into a raster tile.
 *
 * If you need to change colors or change what is drawn you can use the `OsmixRasterTile` class directly.
 */
export function drawRasterTile(osm: Osm, rasterTile: OsmixRasterTile) {
	const tileKey = rasterTile.tile.join("/")
	const bbox = rasterTile.bbox()

	// Get way IDs that are part of relations (to exclude from individual rendering)
	const relationWayIds = osm.relations.getWayMemberIds()

	// Draw relations (multipolygon relations)
	const relationTimer = `OsmixRasterTile.drawRelations:${tileKey}`
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
	const timer = `OsmixRasterTile.drawWays:${tileKey}`
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

	return rasterTile
}
