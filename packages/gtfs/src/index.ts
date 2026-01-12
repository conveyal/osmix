/**
 * @osmix/gtfs - Convert GTFS transit feeds to OSM format.
 *
 * Parses zipped GTFS files and converts transit data to OpenStreetMap entities:
 * - **Stops** become **Nodes** with public transport tags
 * - **Routes** become **Ways** with shape geometry
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
 * @module @osmix/gtfs
 */

export { fromGtfs, GtfsOsmBuilder, parseGtfsZip } from "./from-gtfs"
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
