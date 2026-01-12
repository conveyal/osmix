/**
 * @osmix/gtfs - Convert GTFS transit feeds to OSM format.
 *
 * Parses zipped GTFS files lazily and converts transit data to OpenStreetMap entities:
 * - **Stops** become **Nodes** with public transport tags
 * - **Routes** become **Ways** with shape geometry
 *
 * Files are only parsed when needed, not upfront.
 *
 * @example
 * ```ts
 * import { fromGtfs } from "@osmix/gtfs"
 *
 * const response = await fetch("https://example.com/gtfs.zip")
 * const zipData = await response.arrayBuffer()
 * const osm = await fromGtfs(zipData, { id: "transit" })
 *
 * console.log(`Imported ${osm.nodes.size} stops and ${osm.ways.size} routes`)
 * ```
 *
 * @example Using GtfsArchive directly for custom processing
 * ```ts
 * import { GtfsArchive } from "@osmix/gtfs"
 *
 * const archive = GtfsArchive.fromZip(zipData)
 *
 * // Only parse stops - other files remain unread
 * for await (const stop of archive.iterStops()) {
 *   console.log(stop.stop_name)
 * }
 * ```
 *
 * @module @osmix/gtfs
 */

export { fromGtfs, GtfsOsmBuilder } from "./from-gtfs"
export {
	GtfsArchive,
	type GtfsFileName,
	type GtfsFileTypeMap,
} from "./gtfs-archive"
export {
	routeTypeToOsmRoute,
	wheelchairBoardingToOsm,
	type GtfsAgency,
	type GtfsConversionOptions,
	type GtfsFeed,
	type GtfsRoute,
	type GtfsShapePoint,
	type GtfsStop,
	type GtfsStopTime,
	type GtfsTrip,
} from "./types"
