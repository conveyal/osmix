/**
 * Shortbread Vector Tile Encoder
 * Encodes OSM data into vector tiles following the Shortbread schema
 * Based on https://shortbread-tiles.org/schema/1.0/
 */

import type { Osm } from "@osmix/core"
import { bboxContainsOrIntersects } from "@osmix/shared/bbox-intersects"
import { clipPolygon, clipPolyline } from "@osmix/shared/lineclip"
import { llToTilePx, tileToBbox } from "@osmix/shared/tile"
import type { GeoBbox2D, LonLat, Tile, XY } from "@osmix/shared/types"
import { wayIsArea } from "@osmix/shared/way-is-area"
import {
	type VtSimpleFeature,
	type VtSimpleFeatureGeometry,
	type VtSimpleFeatureType,
	writeVtPbf,
} from "@osmix/vt"
import { matchTags, SHORTBREAD_LAYERS } from "./layers"
import type { ShortbreadLayerName, ShortbreadProperties } from "./types"

const DEFAULT_EXTENT = 4096
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

// Signed area via shoelace formula.
// Positive area => CCW, Negative => CW.
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

function closeRing(ring: XY[]): XY[] {
	const first = ring[0]
	const last = ring[ring.length - 1]
	if (first === undefined || last === undefined) return ring
	if (first[0] !== last[0] || first[1] !== last[1]) {
		return [...ring, first]
	}
	return ring
}

// Remove consecutive duplicates *after* rounding
function cleanRing(ring: XY[]): XY[] {
	const deduped = dedupePoints(ring)
	// After dedupe, we still must ensure closure, and a polygon
	// ring needs at least 4 coords (A,B,C,A).
	const closed = closeRing(deduped)
	if (closed.length < 4) return []
	return closed
}

/**
 * Feature ready for layer aggregation
 */
interface ClassifiedFeature {
	id: number
	layer: ShortbreadLayerName
	type: VtSimpleFeatureType[keyof VtSimpleFeatureType]
	entityType: "node" | "way" | "relation"
	properties: ShortbreadProperties
	geometry: VtSimpleFeatureGeometry
}

/**
 * Shortbread-compliant Vector Tile Encoder
 *
 * Generates vector tiles following the Shortbread schema specification.
 * Features are classified into appropriate layers based on their OSM tags.
 */
export class ShortbreadVtEncoder {
	private readonly osm: Osm
	private readonly extent: number
	private readonly extentBbox: [number, number, number, number]

	/**
	 * Create a new Shortbread encoder
	 * @param osm - The OSM data source
	 * @param extent - Tile extent (default 4096)
	 * @param buffer - Buffer size for clipping (default 64)
	 */
	constructor(osm: Osm, extent = DEFAULT_EXTENT, buffer = DEFAULT_BUFFER) {
		this.osm = osm
		this.extent = extent
		const min = -buffer
		const max = extent + buffer
		this.extentBbox = [min, min, max, max]
	}

	/**
	 * Get all Shortbread layer names
	 */
	static get layerNames(): ShortbreadLayerName[] {
		return SHORTBREAD_LAYERS.map((l) => l.name)
	}

	/**
	 * Generate a vector tile for the given tile coordinates
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
	 * Generate a vector tile for the given bounding box
	 */
	getTileForBbox(bbox: GeoBbox2D, proj: (ll: LonLat) => XY): ArrayBuffer {
		// Collect features by layer
		const featuresByLayer = new Map<ShortbreadLayerName, ClassifiedFeature[]>()

		// Initialize all layers
		for (const layer of SHORTBREAD_LAYERS) {
			featuresByLayer.set(layer.name, [])
		}

		// Get way IDs that are part of relations
		const relationWayIds = this.osm.relations.getWayMemberIds()

		// Process nodes (points)
		for (const feature of this.classifyNodes(bbox, proj)) {
			const layerFeatures = featuresByLayer.get(feature.layer)
			if (layerFeatures) {
				layerFeatures.push(feature)
			}
		}

		// Process ways (lines and polygons)
		for (const feature of this.classifyWays(bbox, proj, relationWayIds)) {
			const layerFeatures = featuresByLayer.get(feature.layer)
			if (layerFeatures) {
				layerFeatures.push(feature)
			}
		}

		// Process relations
		for (const feature of this.classifyRelations(bbox, proj)) {
			const layerFeatures = featuresByLayer.get(feature.layer)
			if (layerFeatures) {
				layerFeatures.push(feature)
			}
		}

		// Build layers array for encoding
		const layers = SHORTBREAD_LAYERS.map((layerDef) => {
			const features = featuresByLayer.get(layerDef.name) ?? []
			return {
				name: layerDef.name,
				version: 2,
				extent: this.extent,
				features: this.featureGenerator(features),
			}
		}).filter((layer) => {
			// Only include layers with features
			const features = featuresByLayer.get(layer.name as ShortbreadLayerName)
			return features && features.length > 0
		})

		return writeVtPbf(layers)
	}

	private *featureGenerator(
		features: ClassifiedFeature[],
	): Generator<VtSimpleFeature> {
		for (const feature of features) {
			// Filter out undefined properties to ensure valid VT encoding
			// Set the type property to the actual OSM entity type (node/way/relation)
			const cleanProperties: VtSimpleFeature["properties"] = {
				type: feature.entityType,
			}
			for (const [key, value] of Object.entries(feature.properties)) {
				if (value !== undefined) {
					// Convert booleans to 0/1 for OsmTags compatibility
					if (typeof value === "boolean") {
						cleanProperties[key] = value ? 1 : 0
					} else {
						cleanProperties[key] = value
					}
				}
			}
			yield {
				id: feature.id,
				type: feature.type,
				properties: cleanProperties,
				geometry: feature.geometry,
			}
		}
	}

	/**
	 * Classify nodes into Shortbread layers
	 */
	private *classifyNodes(
		bbox: GeoBbox2D,
		proj: (ll: LonLat) => XY,
	): Generator<ClassifiedFeature> {
		const nodeIndexes = this.osm.nodes.findIndexesWithinBbox(bbox)

		for (const nodeIndex of nodeIndexes) {
			if (nodeIndex === undefined) continue
			const tags = this.osm.nodes.tags.getTags(nodeIndex)
			if (!tags || Object.keys(tags).length === 0) continue

			const match = matchTags(tags, "Point")
			if (!match) continue

			const id = this.osm.nodes.ids.at(nodeIndex)
			const ll = this.osm.nodes.getNodeLonLat({ index: nodeIndex })

			yield {
				id,
				layer: match.layer.name,
				type: SF_TYPE.POINT,
				entityType: "node",
				properties: match.properties,
				geometry: [[proj(ll)]],
			}
		}
	}

	/**
	 * Classify ways into Shortbread layers
	 */
	private *classifyWays(
		bbox: GeoBbox2D,
		proj: (ll: LonLat) => XY,
		relationWayIds?: Set<number>,
	): Generator<ClassifiedFeature> {
		const wayIndexes = this.osm.ways.intersects(bbox)

		for (const wayIndex of wayIndexes) {
			if (wayIndex === undefined) continue
			const id = this.osm.ways.ids.at(wayIndex)
			// Skip ways that are part of relations
			if (id !== undefined && relationWayIds?.has(id)) continue

			const tags = this.osm.ways.tags.getTags(wayIndex)
			if (!tags || Object.keys(tags).length === 0) continue

			const wayLine = this.osm.ways.getCoordinates(wayIndex)
			const points: XY[] = wayLine.map((ll) => proj(ll))

			const isArea = wayIsArea({
				id,
				refs: this.osm.ways.getRefIds(wayIndex),
				tags,
			})

			const geometryType = isArea ? "Polygon" : "LineString"
			const match = matchTags(tags, geometryType)
			if (!match) continue

			const geometry: VtSimpleFeatureGeometry = []

			if (isArea) {
				const clippedRings = this.clipProjectedPolygon(points)
				for (let ringIndex = 0; ringIndex < clippedRings.length; ringIndex++) {
					const clippedRing = clippedRings[ringIndex]
					if (!clippedRing) continue
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
				layer: match.layer.name,
				type: isArea ? SF_TYPE.POLYGON : SF_TYPE.LINE,
				entityType: "way",
				properties: match.properties,
				geometry,
			}
		}
	}

	/**
	 * Classify relations into Shortbread layers
	 */
	private *classifyRelations(
		bbox: GeoBbox2D,
		proj: (ll: LonLat) => XY,
	): Generator<ClassifiedFeature> {
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
			if (!tags) continue

			if (relationGeometry.rings) {
				// Area relations (multipolygon, boundary)
				const match = matchTags(tags, "Polygon")
				if (!match) continue

				const { rings } = relationGeometry
				if (rings.length === 0) continue

				for (const polygon of rings) {
					const geometry: VtSimpleFeatureGeometry = []

					for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
						const ring = polygon[ringIndex]
						if (!ring || ring.length < 3) continue

						const projectedRing: XY[] = ring.map((ll: LonLat) => proj(ll))
						const clipped = clipPolygon(projectedRing, this.extentBbox)
						if (clipped.length < 3) continue

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
						layer: match.layer.name,
						type: SF_TYPE.POLYGON,
						entityType: "relation",
						properties: match.properties,
						geometry,
					}
				}
			} else if (relationGeometry.lineStrings) {
				// Line relations (route, multilinestring)
				const match = matchTags(tags, "LineString")
				if (!match) continue

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
						layer: match.layer.name,
						type: SF_TYPE.LINE,
						entityType: "relation",
						properties: match.properties,
						geometry,
					}
				}
			} else if (relationGeometry.points) {
				// Point relations
				const match = matchTags(tags, "Point")
				if (!match) continue

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
					layer: match.layer.name,
					type: SF_TYPE.POINT,
					entityType: "relation",
					properties: match.properties,
					geometry,
				}
			}
		}
	}

	private clipProjectedPolyline(points: XY[]): XY[][] {
		return clipPolyline(points, this.extentBbox)
	}

	private clipProjectedPolygon(points: XY[]): XY[][] {
		const clipped = clipPolygon(points, this.extentBbox)
		return [clipped]
	}

	private processClippedPolygonRing(rawRing: XY[], isOuter: boolean): XY[] {
		const snapped = rawRing.map((xy) => this.clampAndRoundPoint(xy))
		const cleaned = cleanRing(snapped)
		if (cleaned.length === 0) return []

		const oriented = isOuter
			? ensureClockwise(cleaned)
			: ensureCounterclockwise(cleaned)

		return oriented
	}

	private clampAndRoundPoint(xy: XY): XY {
		const clampedX = Math.round(
			clamp(xy[0], this.extentBbox[0], this.extentBbox[2]),
		)
		const clampedY = Math.round(
			clamp(xy[1], this.extentBbox[1], this.extentBbox[3]),
		)
		return [clampedX, clampedY] as XY
	}
}
