/**
 * GTFS to OSM conversion utilities.
 *
 * Imports GTFS transit feeds into Osm indexes, mapping:
 * - Stops → Nodes with transit tags
 * - Routes → Ways with shape geometry
 *
 * Uses lazy, on-demand parsing - files are only parsed when needed.
 *
 * @module
 */

import { Osm, type OsmOptions } from "@osmix/core"
import {
	logProgress,
	type ProgressEvent,
	progressEvent,
} from "@osmix/shared/progress"
import type { OsmTags } from "@osmix/shared/types"
import { GtfsArchive } from "./gtfs-archive"
import type { GtfsConversionOptions, GtfsShapePoint } from "./types"
import { routeToTags, stopToTags } from "./utils"

/**
 * Create an Osm index from a zipped GTFS file.
 *
 * Parses the GTFS zip lazily - only reading files when needed.
 * Converts stops and routes to OSM entities:
 * - Stops become nodes with transit-related tags
 * - Routes become ways with shape geometry (if available) or stop sequence
 *
 * @param zipData - The GTFS zip file as ArrayBuffer or Uint8Array
 * @param options - Osm index options (id, header)
 * @param gtfsOptions - GTFS conversion options
 * @param onProgress - Progress callback for UI feedback
 * @returns Populated Osm index with built indexes
 *
 * @example
 * ```ts
 * import { fromGtfs } from "@osmix/gtfs"
 *
 * const response = await fetch("https://example.com/gtfs.zip")
 * const zipData = await response.arrayBuffer()
 * const osm = await fromGtfs(zipData, { id: "transit" })
 *
 * console.log(`Imported ${osm.nodes.size} stops`)
 * ```
 */
export async function fromGtfs(
	zipData: ArrayBuffer | Uint8Array,
	options: Partial<OsmOptions> = {},
	gtfsOptions: GtfsConversionOptions = {},
	onProgress: (progress: ProgressEvent) => void = logProgress,
): Promise<Osm> {
	onProgress(progressEvent("Opening GTFS archive..."))
	const archive = GtfsArchive.fromZip(zipData)
	const builder = new GtfsOsmBuilder(options, onProgress)
	if (gtfsOptions.includeStops ?? true) {
		await builder.processStops(archive)
	}

	if (gtfsOptions.includeRoutes ?? true) {
		await builder.processRoutes(archive)
	}

	return builder.buildOsm()
}

/**
 * Builder class for converting GTFS data to OSM entities.
 *
 * Uses lazy parsing - only reads GTFS files when needed.
 */
export class GtfsOsmBuilder {
	private osm: Osm
	private onProgress: (progress: ProgressEvent) => void

	private nextNodeId = -1
	private nextWayId = -1

	// Map GTFS stop_id to OSM node ID
	private stopIdToNodeId = new Map<string, number>()

	constructor(
		osmOptions: Partial<OsmOptions> = {},
		onProgress: (progress: ProgressEvent) => void = logProgress,
	) {
		this.osm = new Osm(osmOptions)
		this.onProgress = onProgress
	}

	/**
	 * Process GTFS stops into OSM nodes.
	 * Uses streaming iteration to avoid loading all stops at once.
	 */
	async processStops(archive: GtfsArchive) {
		let count = 0

		this.onProgress(progressEvent("Processing stops..."))

		for await (const stop of archive.iter("stops.txt")) {
			const lat = Number.parseFloat(stop.stop_lat)
			const lon = Number.parseFloat(stop.stop_lon)

			if (Number.isNaN(lat) || Number.isNaN(lon)) continue

			const tags = stopToTags(stop)
			const nodeId = this.nextNodeId--

			this.osm.nodes.addNode({
				id: nodeId,
				lat,
				lon,
				tags,
			})

			this.stopIdToNodeId.set(stop.stop_id, nodeId)
			count++

			if (count % 1000 === 0) {
				this.onProgress(progressEvent(`Processed ${count} stops...`))
			}
		}

		this.onProgress(progressEvent(`Added ${count} stops as nodes`))
	}

	/**
	 * Process GTFS routes into OSM ways.
	 * Creates one way per unique (shape_id, route_id) pair, so each route gets
	 * its own way with correct metadata even when routes share the same shape.
	 *
	 * @param archive - The GTFS archive
	 */
	async processRoutes(archive: GtfsArchive) {
		this.onProgress(progressEvent("Processing routes..."))

		// Build shape lookup if shapes exist
		const shapeMap = new Map<string, GtfsShapePoint[]>()
		if (archive.hasFile("shapes.txt")) {
			this.onProgress(progressEvent("Loading shape data..."))
			for await (const point of archive.iter("shapes.txt")) {
				const points = shapeMap.get(point.shape_id) ?? []
				points.push(point)
				shapeMap.set(point.shape_id, points)
			}
			// Sort each shape by sequence
			for (const points of shapeMap.values()) {
				points.sort(
					(a, b) =>
						Number.parseInt(a.shape_pt_sequence, 10) -
						Number.parseInt(b.shape_pt_sequence, 10),
				)
			}
		} else {
			throw Error("No shape data found. Cannot process routes.")
		}

		// Group trips by (shape_id, route_id) to ensure each route gets its own way
		// even when multiple routes share the same shape geometry
		const shapeRouteToTrips = new Map<string, { tripIds: string[] }>()
		this.onProgress(progressEvent("Loading trip data..."))
		for await (const trip of archive.iter("trips.txt")) {
			if (!trip.shape_id) continue

			const key = `${trip.shape_id}:${trip.route_id}`
			const existing = shapeRouteToTrips.get(key)
			if (existing) {
				existing.tripIds.push(trip.trip_id)
			} else {
				shapeRouteToTrips.set(key, { tripIds: [trip.trip_id] })
			}
		}

		// Load routes into a map for lookup
		const routeMap = new Map<string, Awaited<ReturnType<typeof routeToTags>>>()
		for await (const route of archive.iter("routes.txt")) {
			routeMap.set(route.route_id, routeToTags(route))
		}

		// Process unique (shape, route) pairs - one way per combination
		let count = 0
		for (const [key, { tripIds }] of shapeRouteToTrips) {
			const [shapeId, routeId] = key.split(":")
			const routeTags = routeMap.get(routeId!)
			if (!routeTags) continue

			const shapePoints = shapeMap.get(shapeId!)
			if (!shapePoints || shapePoints.length < 2) {
				this.onProgress(
					progressEvent(`No shape data found for shape ${shapeId}`, "error"),
				)
				continue
			}

			// Build tags with route info and all trip IDs for this route
			const tags: OsmTags = {
				...routeTags,
				"gtfs:shape_id": shapeId!,
				"gtfs:trip_ids": tripIds.join(";"),
				"gtfs:trip_count": tripIds.length,
			}

			// Create way from shape points
			this.createWayFromShape(tags, shapePoints)
			count++

			if (count % 100 === 0) {
				this.onProgress(
					progressEvent(`Processed ${count} shape-route pairs...`),
				)
			}
		}

		this.onProgress(progressEvent(`Added ${count} shape-route pairs as ways`))
	}

	/**
	 * Create a way from shape points.
	 */
	private createWayFromShape(tags: OsmTags, shapePoints: GtfsShapePoint[]) {
		const nodeRefs: number[] = []

		for (const point of shapePoints) {
			const lat = Number.parseFloat(point.shape_pt_lat)
			const lon = Number.parseFloat(point.shape_pt_lon)

			if (Number.isNaN(lat) || Number.isNaN(lon)) continue

			// Create a node for this shape point
			const nodeId = this.nextNodeId--
			this.osm.nodes.addNode({
				id: nodeId,
				lat,
				lon,
			})
			nodeRefs.push(nodeId)
		}

		if (nodeRefs.length >= 2) {
			const wayId = this.nextWayId--
			this.osm.ways.addWay({
				id: wayId,
				refs: nodeRefs,
				tags,
			})
		}
	}

	/**
	 * Build the OSM index with all entities.
	 */
	buildOsm(): Osm {
		this.onProgress(progressEvent("Building indexes..."))
		this.osm.buildIndexes()
		this.osm.buildSpatialIndexes()
		return this.osm
	}
}
