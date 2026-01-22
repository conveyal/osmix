/**
 * Vector tile encoding for OSM data.
 *
 * The OsmixVtEncoder class converts Osmix datasets into Mapbox Vector Tiles,
 * handling geometry projection, clipping, area detection, and proper
 * MVT encoding for nodes, ways, and relations.
 *
 * @module
 */

import type { Osm } from "@osmix/core"
import { bboxContainsOrIntersects } from "@osmix/shared/bbox-intersects"
import { normalizeHexColor } from "@osmix/shared/color"
import { clipPolygon, clipPolyline } from "@osmix/shared/lineclip"
import { llToTilePx, tileToBbox } from "@osmix/shared/tile"
import type { GeoBbox2D, LonLat, Tile, XY } from "@osmix/shared/types"
import { wayIsArea } from "@osmix/shared/way-is-area"
import type {
	VtSimpleFeature,
	VtSimpleFeatureGeometry,
	VtSimpleFeatureType,
} from "./types"
import writeVtPbf from "./write-vt-pbf"

/** Default tile extent (coordinate resolution). */
const DEFAULT_EXTENT = 4096
/** Default buffer around tile in extent units. */
const DEFAULT_BUFFER = 64

const SF_TYPE: VtSimpleFeatureType = {
	POINT: 1,
	LINE: 2,
	POLYGON: 3,
}

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max)

function dedupePoints(points: XY[]): XY[] {
	if (points.length < 2) return points
	const result: XY[] = []
	let lastPoint: XY = [Number.NaN, Number.NaN]
	for (const point of points) {
		if (point[0] === lastPoint[0] && point[1] === lastPoint[1]) continue
		result.push(point)
		lastPoint = point
	}
	return result
}

/**
 * Returns a projection function that converts [lon, lat] to [x, y] pixel coordinates
 * relative to the given tile. The extent determines the resolution of the tile
 * (e.g. 4096 means coordinates range from 0 to 4096).
 */
export function projectToTile(
	tile: Tile,
	extent = DEFAULT_EXTENT,
): (ll: LonLat) => XY {
	return (lonLat) => llToTilePx(lonLat, tile, extent)
}

/**
 * Encode an Osm instance into a Mapbox Vector Tile PBF.
 */
export class OsmixVtEncoder {
	readonly nodeLayerName: string
	readonly wayLayerName: string
	readonly relationLayerName: string
	private readonly osm: Osm
	private readonly extent: number
	private readonly extentBbox: [number, number, number, number]

	static layerNames(id: string) {
		return {
			nodeLayerName: `@osmix:${id}:nodes`,
			wayLayerName: `@osmix:${id}:ways`,
			relationLayerName: `@osmix:${id}:relations`,
		}
	}

	constructor(osm: Osm, extent = DEFAULT_EXTENT, buffer = DEFAULT_BUFFER) {
		this.osm = osm

		const min = -buffer
		const max = extent + buffer
		this.extent = extent
		this.extentBbox = [min, min, max, max]

		const layerName = `@osmix:${osm.id}`
		this.nodeLayerName = `${layerName}:nodes`
		this.wayLayerName = `${layerName}:ways`
		this.relationLayerName = `${layerName}:relations`
	}

	/**
	 * Get a vector tile PBF for a specific tile coordinate.
	 * Returns an empty buffer if the tile does not intersect with the OSM dataset.
	 */
	getTile(tile: Tile): ArrayBuffer {
		const bbox = tileToBbox(tile)
		const osmBbox = this.osm.bbox()
		if (!bboxContainsOrIntersects(bbox, osmBbox)) {
			return new ArrayBuffer(0)
		}
		return this.getTileForBbox(bbox, (ll) => llToTilePx(ll, tile, this.extent))
	}

	/**
	 * Get a vector tile PBF for a specific geographic bounding box.
	 * @param bbox The bounding box to include features from.
	 * @param proj A function to project [lon, lat] to [x, y] within the tile extent.
	 */
	getTileForBbox(bbox: GeoBbox2D, proj: (ll: LonLat) => XY): ArrayBuffer {
		// Get way IDs that are part of relations (to exclude from individual rendering)
		const relationWayIds = this.osm.relations.getWayMemberIds()

		const layers = [
			{
				name: this.wayLayerName,
				version: 2,
				extent: this.extent,
				features: this.wayFeatures(bbox, proj, relationWayIds),
			},
			{
				name: this.nodeLayerName,
				version: 2,
				extent: this.extent,
				features: this.nodeFeatures(bbox, proj),
			},
			{
				name: this.relationLayerName,
				version: 2,
				extent: this.extent,
				features: this.relationFeatures(bbox, proj),
			},
		]
		return writeVtPbf(layers)
	}

	*nodeFeatures(
		bbox: GeoBbox2D,
		proj: (ll: LonLat) => XY,
	): Generator<VtSimpleFeature> {
		const nodeIndexes = this.osm.nodes.findIndexesWithinBbox(bbox)
		for (let i = 0; i < nodeIndexes.length; i++) {
			const nodeIndex = nodeIndexes[i]
			if (nodeIndex === undefined) continue
			const tags = this.osm.nodes.tags.getTags(nodeIndex)
			if (!tags || Object.keys(tags).length === 0) continue
			const id = this.osm.nodes.ids.at(nodeIndex)
			const ll = this.osm.nodes.getNodeLonLat({ index: nodeIndex })
			yield {
				id,
				type: SF_TYPE.POINT,
				properties: { ...tags, type: "node" },
				geometry: [[proj(ll)]],
			}
		}
	}

	*wayFeatures(
		bbox: GeoBbox2D,
		proj: (ll: LonLat) => XY,
		relationWayIds?: Set<number>,
	): Generator<VtSimpleFeature> {
		const wayIndexes = this.osm.ways.intersects(bbox)
		for (let i = 0; i < wayIndexes.length; i++) {
			const wayIndex = wayIndexes[i]
			if (wayIndex === undefined) continue
			const id = this.osm.ways.ids.at(wayIndex)
			// Skip ways that are part of relations (they will be rendered via relations)
			if (id !== undefined && relationWayIds?.has(id)) continue
			const tags = this.osm.ways.tags.getTags(wayIndex)
			// Skip ways without tags (they are likely only for relations)
			if (!tags || Object.keys(tags).length === 0) continue
			const normalizedColor = normalizeHexColor(tags["color"] ?? tags["colour"])
			const wayLine = this.osm.ways.getCoordinates(wayIndex)
			const points: XY[] = wayLine.map((ll) => proj(ll))

			const isArea = wayIsArea({
				id,
				refs: this.osm.ways.getRefIds(wayIndex),
				tags,
			})
			const geometry: VtSimpleFeatureGeometry = []
			if (isArea) {
				// 1. clip polygon in tile coords (returns array of rings)
				const clippedRings = this.clipProjectedPolygon(points)

				// 2. process each ring (first is outer, rest would be holes if from relations)
				for (let ringIndex = 0; ringIndex < clippedRings.length; ringIndex++) {
					const clippedRing = clippedRings[ringIndex]
					if (!clippedRing) continue

					// Normalize winding order using rewind before processing
					// GeoJSON: outer counterclockwise, inner clockwise
					// MVT: outer clockwise, inner counterclockwise
					const isOuter = ringIndex === 0
					const processedRing = this.processClippedPolygonRing(
						clippedRing,
						isOuter,
					)

					if (processedRing.length > 0) {
						geometry.push(processedRing)
					}
				}
			} else {
				const clippedSegmentsRaw = this.clipProjectedPolyline(points)
				for (const segment of clippedSegmentsRaw) {
					const rounded = segment.map((xy) => this.clampAndRoundPoint(xy))
					const deduped = dedupePoints(rounded)
					if (deduped.length >= 2) {
						geometry.push(deduped)
					}
				}
			}
			if (geometry.length === 0) continue
			yield {
				id,
				type: isArea ? SF_TYPE.POLYGON : SF_TYPE.LINE,
				properties: {
					...tags,
					...(normalizedColor ? { color: normalizedColor } : {}),
					type: "way",
				},
				geometry,
			}
		}
	}

	clipProjectedPolyline(points: XY[]): XY[][] {
		return clipPolyline(points, this.extentBbox)
	}

	clipProjectedPolygon(points: XY[]): XY[][] {
		// clipPolygon returns a single ring, but we return as array for consistency
		// with multi-ring support (e.g., from relations)
		const clipped = clipPolygon(points, this.extentBbox)
		return [clipped]
	}

	processClippedPolygonRing(rawRing: XY[], isOuter: boolean): XY[] {
		// 1. round & clamp EVERY point
		const snapped = rawRing.map((xy) => this.clampAndRoundPoint(xy))

		// 2. clean (dedupe + close + min length)
		const cleaned = cleanRing(snapped)
		if (cleaned.length === 0) return []

		// 3. enforce winding order per MVT spec:
		//    - Outer rings: clockwise
		//    - Inner rings (holes): counterclockwise
		const oriented = isOuter
			? ensureClockwise(cleaned)
			: ensureCounterclockwise(cleaned)

		return oriented
	}

	/**
	 * Super relations and logical relations are not directly rendered; they would need recursive expansion.
	 */
	*relationFeatures(
		bbox: GeoBbox2D,
		proj: (ll: LonLat) => XY,
	): Generator<VtSimpleFeature> {
		const relationIndexes = this.osm.relations.intersects(bbox)

		for (const relIndex of relationIndexes) {
			const relation = this.osm.relations.getByIndex(relIndex)
			const relationGeometry = this.osm.relations.getRelationGeometry(relIndex)
			if (
				!relation ||
				(!relationGeometry.lineStrings &&
					!relationGeometry.rings &&
					!relationGeometry.points)
			)
				continue

			const id = this.osm.relations.ids.at(relIndex)
			const tags = this.osm.relations.tags.getTags(relIndex)

			if (relationGeometry.rings) {
				// Area relations (multipolygon, boundary)
				const { rings } = relationGeometry
				if (rings.length === 0) continue

				// Process each polygon in the relation
				for (const polygon of rings) {
					const geometry: VtSimpleFeatureGeometry = []

					// Process outer ring and inner rings (holes)
					for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
						const ring = polygon[ringIndex]
						if (!ring || ring.length < 3) continue

						// Project ring to tile coordinates
						const projectedRing: XY[] = ring.map((ll: LonLat) => proj(ll))

						// Clip polygon ring
						const clipped = clipPolygon(projectedRing, this.extentBbox)
						if (clipped.length < 3) continue

						// Process ring (round/clamp, dedupe, close, orient)
						const isOuter = ringIndex === 0
						const processedRing = this.processClippedPolygonRing(
							clipped,
							isOuter,
						)

						if (processedRing.length > 0) {
							geometry.push(processedRing)
						}
					}

					if (geometry.length === 0) continue

					yield {
						id: id ?? 0,
						type: SF_TYPE.POLYGON,
						properties: { ...tags, type: "relation" },
						geometry,
					}
				}
			} else if (relationGeometry.lineStrings) {
				// Line relations (route, multilinestring)
				const { lineStrings } = relationGeometry
				if (lineStrings.length === 0) continue

				for (const lineString of lineStrings) {
					const geometry: VtSimpleFeatureGeometry = []
					const points: XY[] = lineString.map((ll) => proj(ll))
					const clippedSegmentsRaw = this.clipProjectedPolyline(points)
					for (const segment of clippedSegmentsRaw) {
						const rounded = segment.map((xy) => this.clampAndRoundPoint(xy))
						const deduped = dedupePoints(rounded)
						if (deduped.length >= 2) {
							geometry.push(deduped)
						}
					}
					if (geometry.length === 0) continue

					yield {
						id: id ?? 0,
						type: SF_TYPE.LINE,
						properties: { ...tags, type: "relation" },
						geometry,
					}
				}
			} else if (relationGeometry.points) {
				// Point relations (multipoint)
				const { points } = relationGeometry
				if (points.length === 0) continue

				const geometry: VtSimpleFeatureGeometry = []
				for (const point of points) {
					const projected = proj(point)
					const clamped = this.clampAndRoundPoint(projected)
					geometry.push([clamped])
				}

				if (geometry.length === 0) continue

				yield {
					id: id ?? 0,
					type: SF_TYPE.POINT,
					properties: { ...tags, type: "relation" },
					geometry,
				}
			}
		}
	}

	clampAndRoundPoint(xy: XY): XY {
		const clampedX = Math.round(
			clamp(xy[0], this.extentBbox[0], this.extentBbox[2]),
		)
		const clampedY = Math.round(
			clamp(xy[1], this.extentBbox[1], this.extentBbox[3]),
		)
		return [clampedX, clampedY] as XY
	}
}

/**
 * Ensures the ring is closed (first and last points are identical).
 * If not, appends the first point to the end.
 */
function closeRing(ring: XY[]): XY[] {
	const first = ring[0]
	const last = ring[ring.length - 1]
	if (first === undefined || last === undefined) return ring
	if (first[0] !== last[0] || first[1] !== last[1]) {
		return [...ring, first]
	}
	return ring
}

/**
 * Signed area via shoelace formula.
 * Positive area => CCW, Negative => CW.
 */
function ringArea(ring: XY[]): number {
	let sum = 0
	for (let i = 0; i < ring.length - 1; i++) {
		const [x1, y1] = ring[i]!
		const [x2, y2] = ring[i + 1]!
		sum += x1 * y2 - x2 * y1
	}
	return sum / 2
}

function ensureClockwise(ring: XY[]): XY[] {
	return ringArea(ring) < 0 ? ring : [...ring].reverse()
}

function ensureCounterclockwise(ring: XY[]): XY[] {
	return ringArea(ring) > 0 ? ring : [...ring].reverse()
}

/**
 * Clean a polygon ring by removing consecutive duplicates, ensuring it's closed,
 * and checking that it has at least 4 coordinates (3 unique points).
 */
function cleanRing(ring: XY[]): XY[] {
	const deduped = dedupePoints(ring)
	// After dedupe, we still must ensure closure, and a polygon
	// ring needs at least 4 coords (A,B,C,A).
	const closed = closeRing(deduped)
	if (closed.length < 4) return []
	return closed
}
