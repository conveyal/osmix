import { zipSync } from "fflate"

/**
 * Create a test GTFS zip file with sample data.
 */
export async function createTestGtfsZip(): Promise<Uint8Array> {
	const encoder = new TextEncoder()

	const files: Record<string, Uint8Array> = {
		"agency.txt":
			encoder.encode(`agency_id,agency_name,agency_url,agency_timezone
agency1,Test Transit,https://example.com,America/New_York`),

		"stops.txt":
			encoder.encode(`stop_id,stop_name,stop_lat,stop_lon,location_type,wheelchair_boarding
stop1,Main St Station,40.7128,-74.0060,0,1
stop2,Broadway Station,40.7580,-73.9855,1,2
stop3,Park Ave Stop,40.7614,-73.9776,0,0`),

		"routes.txt":
			encoder.encode(`route_id,route_short_name,route_long_name,route_type,route_color,route_text_color
route1,1,Downtown Express,3,FF0000,FFFFFF`),

		"trips.txt": encoder.encode(`trip_id,route_id,service_id,shape_id
trip1,route1,weekday,shape1`),

		"stop_times.txt":
			encoder.encode(`trip_id,stop_id,stop_sequence,arrival_time,departure_time
trip1,stop1,1,08:00:00,08:00:00
trip1,stop2,2,08:10:00,08:10:00
trip1,stop3,3,08:20:00,08:20:00`),

		"shapes.txt":
			encoder.encode(`shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence
shape1,40.7128,-74.0060,1
shape1,40.7400,-73.9900,2
shape1,40.7614,-73.9776,3`),

		"calendar.txt":
			encoder.encode(`service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
weekday,1,1,1,1,1,0,0,20240101,20241231`),
	}

	return zipSync(files)
}

/**
 * Create a minimal GTFS zip with just stops (no routes or shapes).
 */
export async function createMinimalGtfsZip(): Promise<Uint8Array> {
	const encoder = new TextEncoder()

	const files: Record<string, Uint8Array> = {
		"agency.txt":
			encoder.encode(`agency_id,agency_name,agency_url,agency_timezone
agency1,Minimal Transit,https://example.com,America/New_York`),

		"stops.txt": encoder.encode(`stop_id,stop_name,stop_lat,stop_lon
stop1,Test Stop,40.7128,-74.0060`),

		"routes.txt":
			encoder.encode(`route_id,route_short_name,route_long_name,route_type
route1,M,Metro Line,1`),

		"trips.txt": encoder.encode(`trip_id,route_id,service_id
trip1,route1,daily`),

		"stop_times.txt": encoder.encode(`trip_id,stop_id,stop_sequence
trip1,stop1,1`),
	}

	return zipSync(files)
}

/**
 * Create a GTFS zip with routes but no shapes (uses stop sequence as fallback).
 */
export async function createGtfsZipWithoutShapes(): Promise<Uint8Array> {
	const encoder = new TextEncoder()

	const files: Record<string, Uint8Array> = {
		"agency.txt":
			encoder.encode(`agency_id,agency_name,agency_url,agency_timezone
agency1,No Shape Transit,https://example.com,America/New_York`),

		"stops.txt": encoder.encode(`stop_id,stop_name,stop_lat,stop_lon
stop1,First Stop,40.7128,-74.0060
stop2,Second Stop,40.7300,-73.9900
stop3,Third Stop,40.7500,-73.9800`),

		"routes.txt":
			encoder.encode(`route_id,route_short_name,route_long_name,route_type
route1,A,Line A,3`),

		"trips.txt": encoder.encode(`trip_id,route_id,service_id
trip1,route1,daily`),

		"stop_times.txt": encoder.encode(`trip_id,stop_id,stop_sequence
trip1,stop1,1
trip1,stop2,2
trip1,stop3,3`),
	}

	return zipSync(files)
}
