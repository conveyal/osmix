/**
 * GTFS to OSM conversion utilities.
 *
 * Imports GTFS transit feeds into Osm indexes, mapping:
 * - Stops → Nodes with transit tags
 * - Routes → Ways with shape geometry
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
import { unzip } from "but-unzip"
import { csvParse } from "d3-dsv"
import {
	type GtfsAgency,
	type GtfsConversionOptions,
	type GtfsFeed,
	type GtfsRoute,
	type GtfsShapePoint,
	type GtfsStop,
	type GtfsStopTime,
	type GtfsTrip,
	routeTypeToOsmRoute,
	wheelchairBoardingToOsm,
} from "./types"

/**
 * Create an Osm index from a zipped GTFS file.
 *
 * Parses the GTFS zip, extracts stops and routes, and converts them
 * to OSM entities:
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
	const builder = new GtfsOsmBuilder(options, gtfsOptions, onProgress)

	onProgress(progressEvent("Parsing GTFS zip file..."))
	const feed = await builder.parseGtfsZip(zipData)

	onProgress(
		progressEvent(
			`Processing ${feed.stops.length} stops and ${feed.routes.length} routes...`,
		),
	)
	builder.processGtfsFeed(feed)

	return builder.buildOsm()
}

/**
 * Parse a GTFS zip file and return the parsed feed data.
 *
 * @param zipData - The GTFS zip file as ArrayBuffer or Uint8Array
 * @returns Parsed GTFS feed with all relevant files
 */
export async function parseGtfsZip(
	zipData: ArrayBuffer | Uint8Array,
): Promise<GtfsFeed> {
	const bytes =
		zipData instanceof Uint8Array ? zipData : new Uint8Array(zipData)
	const entries = unzip(bytes)

	const files = new Map<string, string>()
	for (const entry of entries) {
		const name = entry.filename.replace(/^.*\//, "") // Remove directory prefix
		if (name.endsWith(".txt")) {
			const data = entry.read()
			const content = new TextDecoder().decode(
				data instanceof Promise ? await data : data,
			)
			files.set(name, content)
		}
	}

	const parseFile = <T>(filename: string): T[] => {
		const content = files.get(filename)
		if (!content) return []
		return csvParse(content) as unknown as T[]
	}

	return {
		agencies: parseFile<GtfsAgency>("agency.txt"),
		stops: parseFile<GtfsStop>("stops.txt"),
		routes: parseFile<GtfsRoute>("routes.txt"),
		trips: parseFile<GtfsTrip>("trips.txt"),
		stopTimes: parseFile<GtfsStopTime>("stop_times.txt"),
		shapes: parseFile<GtfsShapePoint>("shapes.txt"),
	}
}

/**
 * Builder class for converting GTFS data to OSM entities.
 */
export class GtfsOsmBuilder {
	private osm: Osm
	private gtfsOptions: GtfsConversionOptions
	private onProgress: (progress: ProgressEvent) => void

	private nextNodeId = -1
	private nextWayId = -1

	// Map GTFS stop_id to OSM node ID
	private stopIdToNodeId = new Map<string, number>()

	constructor(
		osmOptions: Partial<OsmOptions> = {},
		gtfsOptions: GtfsConversionOptions = {},
		onProgress: (progress: ProgressEvent) => void = logProgress,
	) {
		this.osm = new Osm(osmOptions)
		this.gtfsOptions = gtfsOptions
		this.onProgress = onProgress
	}

	/**
	 * Parse a GTFS zip file.
	 */
	async parseGtfsZip(zipData: ArrayBuffer | Uint8Array): Promise<GtfsFeed> {
		return parseGtfsZip(zipData)
	}

	/**
	 * Process the parsed GTFS feed and add entities to the OSM index.
	 */
	processGtfsFeed(feed: GtfsFeed) {
		// Process stops first (they become nodes)
		this.processStops(feed.stops)

		// Process routes (they become ways)
		this.processRoutes(feed)
	}

	/**
	 * Process GTFS stops into OSM nodes.
	 */
	private processStops(stops: GtfsStop[]) {
		const { stopTypes } = this.gtfsOptions
		let count = 0

		for (const stop of stops) {
			// Filter by location_type if specified
			if (stopTypes !== undefined) {
				const locationType = Number.parseInt(stop.location_type ?? "0", 10)
				if (!stopTypes.includes(locationType)) continue
			}

			const lat = Number.parseFloat(stop.stop_lat)
			const lon = Number.parseFloat(stop.stop_lon)

			if (Number.isNaN(lat) || Number.isNaN(lon)) continue

			const tags = this.stopToTags(stop)
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
	 * Convert a GTFS stop to OSM tags.
	 */
	private stopToTags(stop: GtfsStop): OsmTags {
		const tags: OsmTags = {
			public_transport: "platform",
		}

		if (stop.stop_name) tags["name"] = stop.stop_name
		if (stop.stop_id) tags["ref"] = stop.stop_id
		if (stop.stop_code) tags["ref:gtfs:stop_code"] = stop.stop_code
		if (stop.stop_desc) tags["description"] = stop.stop_desc
		if (stop.stop_url) tags["website"] = stop.stop_url
		if (stop.platform_code) tags["ref:platform"] = stop.platform_code

		// Location type determines more specific tagging
		const locationType = stop.location_type ?? "0"
		switch (locationType) {
			case "1":
				tags["public_transport"] = "station"
				break
			case "2":
				tags["railway"] = "subway_entrance"
				break
			case "3":
				// Generic node - keep as platform
				break
			case "4":
				tags["public_transport"] = "platform"
				break
		}

		// Wheelchair accessibility
		const wheelchair = wheelchairBoardingToOsm(stop.wheelchair_boarding)
		if (wheelchair) tags["wheelchair"] = wheelchair

		return tags
	}

	/**
	 * Process GTFS routes into OSM ways.
	 */
	private processRoutes(feed: GtfsFeed) {
		const { routeTypes, includeShapes = true } = this.gtfsOptions

		// Build shape lookup if available
		const shapeMap = new Map<string, GtfsShapePoint[]>()
		if (includeShapes && feed.shapes.length > 0) {
			for (const point of feed.shapes) {
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
		}

		// Build route -> shape mapping via trips
		const routeToShapeId = new Map<string, string>()
		for (const trip of feed.trips) {
			if (trip.shape_id && !routeToShapeId.has(trip.route_id)) {
				routeToShapeId.set(trip.route_id, trip.shape_id)
			}
		}

		// Build route -> stops mapping via trips and stop_times (fallback if no shapes)
		const routeToStops = new Map<string, string[]>()
		if (shapeMap.size === 0) {
			// Group stop_times by trip
			const tripToStops = new Map<string, GtfsStopTime[]>()
			for (const stopTime of feed.stopTimes) {
				const times = tripToStops.get(stopTime.trip_id) ?? []
				times.push(stopTime)
				tripToStops.set(stopTime.trip_id, times)
			}

			// Get one trip per route and extract stop sequence
			for (const trip of feed.trips) {
				if (routeToStops.has(trip.route_id)) continue
				const stopTimes = tripToStops.get(trip.trip_id)
				if (stopTimes && stopTimes.length > 0) {
					stopTimes.sort(
						(a, b) =>
							Number.parseInt(a.stop_sequence, 10) -
							Number.parseInt(b.stop_sequence, 10),
					)
					routeToStops.set(
						trip.route_id,
						stopTimes.map((st) => st.stop_id),
					)
				}
			}
		}

		let count = 0
		for (const route of feed.routes) {
			// Filter by route_type if specified
			if (routeTypes !== undefined) {
				const routeType = Number.parseInt(route.route_type, 10)
				if (!routeTypes.includes(routeType)) continue
			}

			const tags = this.routeToTags(route)

			// Try to get shape geometry
			const shapeId = routeToShapeId.get(route.route_id)
			const shapePoints = shapeId ? shapeMap.get(shapeId) : undefined

			if (shapePoints && shapePoints.length >= 2) {
				// Create way from shape points
				this.createWayFromShape(tags, shapePoints)
			} else {
				// Fall back to stop sequence
				const stopIds = routeToStops.get(route.route_id)
				if (stopIds && stopIds.length >= 2) {
					this.createWayFromStops(tags, stopIds)
				}
				// If neither shape nor stops available, skip this route
			}

			count++
			if (count % 100 === 0) {
				this.onProgress(progressEvent(`Processed ${count} routes...`))
			}
		}

		this.onProgress(progressEvent(`Added ${count} routes as ways`))
	}

	/**
	 * Convert a GTFS route to OSM tags.
	 */
	private routeToTags(route: GtfsRoute): OsmTags {
		const tags: OsmTags = {
			route: routeTypeToOsmRoute(route.route_type),
		}

		// Use long name if available, otherwise short name
		if (route.route_long_name) {
			tags["name"] = route.route_long_name
		} else if (route.route_short_name) {
			tags["name"] = route.route_short_name
		}

		if (route.route_short_name) tags["ref"] = route.route_short_name
		if (route.route_id) tags["ref:gtfs:route_id"] = route.route_id
		if (route.route_desc) tags["description"] = route.route_desc
		if (route.route_url) tags["website"] = route.route_url

		// Route color (normalize to include # prefix)
		if (route.route_color) {
			const color = route.route_color.startsWith("#")
				? route.route_color
				: `#${route.route_color}`
			tags["color"] = color
		}

		if (route.route_text_color) {
			const textColor = route.route_text_color.startsWith("#")
				? route.route_text_color
				: `#${route.route_text_color}`
			tags["text_color"] = textColor
		}

		// Route type as additional tag
		tags["gtfs:route_type"] = route.route_type

		return tags
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
	 * Create a way from stop IDs (fallback when no shape data).
	 */
	private createWayFromStops(tags: OsmTags, stopIds: string[]) {
		const nodeRefs: number[] = []

		for (const stopId of stopIds) {
			const nodeId = this.stopIdToNodeId.get(stopId)
			if (nodeId !== undefined) {
				nodeRefs.push(nodeId)
			}
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
