import type { OsmTags } from "@osmix/shared/types"
import type { DefaultSpeeds } from "./types"

/** Default speeds (km/h) by highway type. */
export const DEFAULT_SPEEDS: DefaultSpeeds = {
	motorway: 120,
	motorway_link: 60,
	trunk: 100,
	trunk_link: 50,
	primary: 80,
	primary_link: 50,
	secondary: 70,
	secondary_link: 50,
	tertiary: 60,
	tertiary_link: 50,
	unclassified: 50,
	residential: 30,
	living_street: 20,
	service: 20,
	footway: 5,
	path: 5,
	cycleway: 20,
	bridleway: 10,
	steps: 2,
}

/** Highways included in default vehicle routing. */
const VEHICLE_HIGHWAYS = new Set([
	"motorway",
	"motorway_link",
	"trunk",
	"trunk_link",
	"primary",
	"primary_link",
	"secondary",
	"secondary_link",
	"tertiary",
	"tertiary_link",
	"unclassified",
	"residential",
	"living_street",
	"service",
])

/** Parse maxspeed tag to km/h. Handles "50", "50 km/h", "30 mph". */
export function parseMaxSpeed(
	value: string | number | undefined,
): number | null {
	if (!value) return null

	const str = String(value).trim().toLowerCase()

	// Numeric: assume km/h
	const numeric = str.match(/^(\d+)$/)
	if (numeric) return Number.parseInt(numeric[1]!, 10)

	// Explicit km/h
	const kmh = str.match(/^(\d+)\s*(km\/h|kmh|kph)$/)
	if (kmh) return Number.parseInt(kmh[1]!, 10)

	// MPH -> km/h
	const mph = str.match(/^(\d+)\s*mph$/)
	if (mph) return Math.round(Number.parseInt(mph[1]!, 10) * 1.60934)

	// Special values
	if (str === "walk" || str === "none") return 5

	return null
}

/** Get speed limit (km/h) for a way. */
export function getSpeedLimit(
	tags: OsmTags | undefined,
	defaultSpeeds: DefaultSpeeds = DEFAULT_SPEEDS,
): number {
	if (tags?.["maxspeed"]) {
		const parsed = parseMaxSpeed(tags["maxspeed"])
		if (parsed !== null) return parsed
	}

	const highway = tags?.["highway"] ? String(tags["highway"]) : undefined
	if (highway && defaultSpeeds[highway]) return defaultSpeeds[highway]!

	return 50
}

/** Travel time in seconds given distance (m) and speed (km/h). */
export function calculateTime(
	distanceMeters: number,
	speedKmh: number,
): number {
	const speedMs = (speedKmh * 1000) / 3600
	return distanceMeters / speedMs
}

/** Default filter: common vehicle highways. */
export function defaultHighwayFilter(tags?: OsmTags): boolean {
	if (!tags?.["highway"]) return false
	return VEHICLE_HIGHWAYS.has(String(tags["highway"]))
}
