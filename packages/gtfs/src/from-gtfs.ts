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
import type { GtfsConversionOptions, GtfsShapePoint, GtfsTrip } from "./types"
import { routeToTags, stopToTags, tripToTags } from "./utils"

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
	 * Only parses shapes/trips/stop_times if needed.
	 *
	 * @param archive - The GTFS archive
	 */
	async processRoutes(archive: GtfsArchive) {
		this.onProgress(progressEvent("Processing routes..."))

		// Build shape lookup if shapes exist and are requested
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

		// Build route -> shape mapping via trips (only if we have shapes)
		const routeTrips = new Map<string, GtfsTrip[]>()
		const tripToShapeId = new Map<string, string>()
		const routeShapes = new Map<string, Set<string>>()
		this.onProgress(progressEvent("Loading trip data..."))
		for await (const trip of archive.iter("trips.txt")) {
			if (trip.shape_id) {
				tripToShapeId.set(trip.trip_id, trip.shape_id)
				const shapes = routeShapes.get(trip.route_id) ?? new Set<string>()
				shapes.add(trip.shape_id)
				routeShapes.set(trip.route_id, shapes)
			}
			const trips = routeTrips.get(trip.route_id) ?? []
			trips.push(trip)
			routeTrips.set(trip.route_id, trips)
		}

		// Process routes
		let count = 0
		for await (const route of archive.iter("routes.txt")) {
			const routeTags = routeToTags(route)
			const trips = routeTrips.get(route.route_id)
			const shapes = routeShapes.get(route.route_id)
			if (!trips || !shapes) continue

			for (const trip of trips) {
				// Add trip tags to route tags
				const tags = { ...routeTags, ...tripToTags(trip) }

				// Try to get shape geometry
				const shapeId = tripToShapeId.get(trip.trip_id)
				const shapePoints = shapeId ? shapeMap.get(shapeId) : undefined

				if (shapePoints && shapePoints.length >= 2) {
					// Create way from shape points
					this.createWayFromShape(tags, shapePoints)
					count++
				} else {
					this.onProgress(
						progressEvent(
							`No shape data found for trip ${trip.trip_id}`,
							"error",
						),
					)
				}

				if (count % 100 === 0 && count > 0) {
					this.onProgress(progressEvent(`Processed ${count} routes...`))
				}
			}
		}

		this.onProgress(progressEvent(`Added ${count} routes as ways`))
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
