import type { OsmTags } from "@osmix/shared/types"
import {
	type GtfsRoute,
	type GtfsStop,
	type GtfsTrip,
	routeTypeToOsmRoute,
	wheelchairBoardingToOsm,
} from "./types"

/**
 * Check if a ZIP file (as bytes) is a GTFS archive by looking for characteristic GTFS files.
 * GTFS archives must contain at least agency.txt, stops.txt, routes.txt, trips.txt,
 * and stop_times.txt according to the GTFS specification.
 */
export function isGtfsZip(bytes: Uint8Array): boolean {
	// GTFS required files per the spec
	const requiredGtfsFiles = [
		"agency.txt",
		"stops.txt",
		"routes.txt",
		"trips.txt",
		"stop_times.txt",
	]

	// Find filenames in the ZIP by scanning for the local file headers
	// ZIP local file header signature: 0x04034b50 (little-endian: 50 4b 03 04)
	const foundFiles = new Set<string>()
	const decoder = new TextDecoder()
	let pos = 0

	while (pos < bytes.length - 30) {
		// Check for ZIP local file header signature
		const isLocalHeader =
			bytes[pos] === 0x50 &&
			bytes[pos + 1] === 0x4b &&
			bytes[pos + 2] === 0x03 &&
			bytes[pos + 3] === 0x04

		if (isLocalHeader) {
			// Read filename length at offset 26-27 (little-endian)
			const nameLen = (bytes[pos + 26] ?? 0) | ((bytes[pos + 27] ?? 0) << 8)
			// Read extra field length at offset 28-29 (little-endian)
			const extraLen = (bytes[pos + 28] ?? 0) | ((bytes[pos + 29] ?? 0) << 8)

			// Defensive bounds check
			if (nameLen < 0 || extraLen < 0) break
			if (pos + 30 + nameLen + extraLen > bytes.length) break

			// General purpose bit flag at offset 6-7 (little-endian)
			// Bit 3 indicates the presence of a data descriptor, in which case
			// the compressed size fields in the local header are zero and the
			// actual sizes follow the compressed data.
			const flags = (bytes[pos + 6] ?? 0) | ((bytes[pos + 7] ?? 0) << 8)
			const hasDataDescriptor = (flags & 0x0008) !== 0

			// Extract filename (starts at offset 30)
			const nameBytes = bytes.slice(pos + 30, pos + 30 + nameLen)
			const filename = decoder.decode(nameBytes)

			// Normalize path - extract just the filename part
			const basename = filename.replace(/^.*\//, "").toLowerCase()
			if (basename) {
				foundFiles.add(basename)
			}

			if (!hasDataDescriptor) {
				// Read compressed size at offset 18-21 (little-endian)
				const compSize =
					(bytes[pos + 18] ?? 0) |
					((bytes[pos + 19] ?? 0) << 8) |
					((bytes[pos + 20] ?? 0) << 16) |
					((bytes[pos + 21] ?? 0) << 24)

				// Move to next entry using the known compressed size
				pos += 30 + nameLen + extraLen + compSize
			} else {
				// When a data descriptor is present, the compressed size is not
				// available in the local header. Skip past the header, filename,
				// and extra fields, then scan forward for the next local header
				// signature. This avoids getting stuck at the same position when
				// the compressed size field is zero.
				pos += 30 + nameLen + extraLen

				while (pos < bytes.length - 3) {
					const nextIsHeader =
						bytes[pos] === 0x50 &&
						bytes[pos + 1] === 0x4b &&
						bytes[pos + 2] === 0x03 &&
						bytes[pos + 3] === 0x04
					if (nextIsHeader) break
					pos++
				}
			}
		} else {
			pos++
		}
	}

	// Check if all required GTFS files are present
	return requiredGtfsFiles.every((f) => foundFiles.has(f))
}

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
			// Entrances are not platforms - remove the default and use railway tag
			delete tags["public_transport"]
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
