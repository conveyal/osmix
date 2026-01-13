import type { OsmTags } from "@osmix/shared/types"
import {
	type GtfsRoute,
	type GtfsStop,
	type GtfsTrip,
	routeTypeToOsmRoute,
	wheelchairBoardingToOsm,
} from "./types"

/**
 * Convert a GTFS stop to OSM tags.
 */
export function stopToTags(stop: GtfsStop): OsmTags {
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
 * Convert a GTFS route to OSM tags.
 */
export function routeToTags(route: GtfsRoute): OsmTags {
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
 * Convert a GTFS trip to OSM tags.
 */
export function tripToTags(trip: GtfsTrip): OsmTags {
	const tags: OsmTags = {}
	tags["ref:gtfs:trip_id"] = trip.trip_id
	if (trip.service_id) tags["ref:gtfs:service_id"] = trip.service_id
	if (trip.trip_headsign) tags["ref:gtfs:trip_headsign"] = trip.trip_headsign
	if (trip.trip_short_name)
		tags["ref:gtfs:trip_short_name"] = trip.trip_short_name
	if (trip.direction_id) tags["ref:gtfs:direction_id"] = trip.direction_id
	if (trip.block_id) tags["ref:gtfs:block_id"] = trip.block_id
	if (trip.shape_id) tags["ref:gtfs:shape_id"] = trip.shape_id
	if (trip.wheelchair_accessible)
		tags["ref:gtfs:wheelchair_accessible"] = trip.wheelchair_accessible
	if (trip.bikes_allowed) tags["ref:gtfs:bikes_allowed"] = trip.bikes_allowed

	return tags
}
/**
 * Create a ReadableStream of text from file bytes.
 */
export function bytesToTextStream(bytes: Uint8Array): ReadableStream<string> {
	const decoder = new TextDecoder()
	let offset = 0
	const chunkSize = 64 * 1024 // 64KB chunks

	return new ReadableStream<string>({
		pull(controller) {
			if (offset >= bytes.length) {
				controller.close()
				return
			}

			const end = Math.min(offset + chunkSize, bytes.length)
			const chunk = bytes.subarray(offset, end)
			offset = end

			controller.enqueue(
				decoder.decode(chunk, { stream: offset < bytes.length }),
			)
		},
	})
}
