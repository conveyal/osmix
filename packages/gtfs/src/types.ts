/**
 * GTFS (General Transit Feed Specification) type definitions.
 *
 * @module
 */

/**
 * GTFS stop from stops.txt.
 * Represents a transit stop or station.
 */
export interface GtfsStop {
	stop_id: string
	stop_code?: string
	stop_name: string
	stop_desc?: string
	stop_lat: string
	stop_lon: string
	zone_id?: string
	stop_url?: string
	/** 0 = stop, 1 = station, 2 = entrance/exit, 3 = generic node, 4 = boarding area */
	location_type?: string
	parent_station?: string
	stop_timezone?: string
	/** 0 = no info, 1 = accessible, 2 = not accessible */
	wheelchair_boarding?: string
	level_id?: string
	platform_code?: string
}

/**
 * GTFS route from routes.txt.
 * Represents a transit route/line.
 */
export interface GtfsRoute {
	route_id: string
	agency_id?: string
	route_short_name?: string
	route_long_name?: string
	route_desc?: string
	/**
	 * Route type:
	 * 0 = Tram, 1 = Subway, 2 = Rail, 3 = Bus, 4 = Ferry,
	 * 5 = Cable tram, 6 = Aerial lift, 7 = Funicular,
	 * 11 = Trolleybus, 12 = Monorail
	 */
	route_type: string
	route_url?: string
	route_color?: string
	route_text_color?: string
	route_sort_order?: string
	continuous_pickup?: string
	continuous_drop_off?: string
	network_id?: string
}

/**
 * GTFS shape point from shapes.txt.
 * Defines the geographic path of a route.
 */
export interface GtfsShapePoint {
	shape_id: string
	shape_pt_lat: string
	shape_pt_lon: string
	shape_pt_sequence: string
	shape_dist_traveled?: string
}

/**
 * GTFS trip from trips.txt.
 * Represents a specific trip on a route.
 */
export interface GtfsTrip {
	trip_id: string
	route_id: string
	service_id: string
	trip_headsign?: string
	trip_short_name?: string
	direction_id?: string
	block_id?: string
	shape_id?: string
	wheelchair_accessible?: string
	bikes_allowed?: string
}

/**
 * GTFS stop time from stop_times.txt.
 * Links trips to stops with timing info.
 */
export interface GtfsStopTime {
	trip_id: string
	arrival_time?: string
	departure_time?: string
	stop_id: string
	stop_sequence: string
	stop_headsign?: string
	pickup_type?: string
	drop_off_type?: string
	continuous_pickup?: string
	continuous_drop_off?: string
	shape_dist_traveled?: string
	timepoint?: string
}

/**
 * GTFS agency from agency.txt.
 */
export interface GtfsAgency {
	agency_id?: string
	agency_name: string
	agency_url: string
	agency_timezone: string
	agency_lang?: string
	agency_phone?: string
	agency_fare_url?: string
	agency_email?: string
}

/**
 * Parsed GTFS feed with all relevant files.
 */
export interface GtfsFeed {
	agencies: GtfsAgency[]
	stops: GtfsStop[]
	routes: GtfsRoute[]
	trips: GtfsTrip[]
	stopTimes: GtfsStopTime[]
	shapes: GtfsShapePoint[]
}

/**
 * Options for GTFS to OSM conversion.
 */
export interface GtfsConversionOptions {
	/** Whether to include stops as nodes. Default: true */
	includeStops?: boolean
	/** Whether to include routes as ways. Default: true */
	includeRoutes?: boolean
}

/**
 * Map GTFS route_type to OSM route tag value.
 */
export function routeTypeToOsmRoute(routeType: string): string {
	switch (routeType) {
		case "0":
			return "tram"
		case "1":
			return "subway"
		case "2":
			return "train"
		case "3":
			return "bus"
		case "4":
			return "ferry"
		case "5":
			return "tram" // Cable tram
		case "6":
			return "aerialway"
		case "7":
			return "funicular"
		case "11":
			return "trolleybus"
		case "12":
			return "train" // Monorail
		default:
			return "bus"
	}
}

/**
 * Map GTFS wheelchair_boarding to OSM wheelchair tag value.
 */
export function wheelchairBoardingToOsm(
	value: string | undefined,
): string | undefined {
	switch (value) {
		case "1":
			return "yes"
		case "2":
			return "no"
		default:
			return undefined
	}
}
