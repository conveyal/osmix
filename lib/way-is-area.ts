import type { OsmTags } from "./types"

/**
 * Tags that imply an area unless their value is exactly "no"
 */
const IMPLIED_ANY_VALUE_BUT_NO = new Set([
	"amenity",
	"boundary",
	"building",
	"building:part",
	"craft",
	"golf",
	"historic",
	"indoor",
	"landuse",
	"leisure",
	"military",
	"office",
	"place",
	"public_transport",
	"ruins",
	"shop",
	"tourism",
])

/**
 * Tags that imply an area only for these specific values
 */
const INCLUDED_VALUE_TAGS = {
	barrier: new Set([
		"city_wall",
		"ditch",
		"hedge",
		"retaining_wall",
		"wall",
		"spikes",
	]),
	highway: new Set(["services", "rest_area", "escape", "elevator"]),
	power: new Set(["plant", "substation", "generator", "transformer"]),
	railway: new Set(["station", "turntable", "roundhouse", "platform"]),
	waterway: new Set(["riverbank", "dock", "boatyard", "dam"]),
} as const

/**
 * Tags that imply an area unless the value is in this exclusion list
 */
const EXCLUDED_VALUE_TAGS = {
	aeroway: new Set(["no", "taxiway"]),
	"area:highway": new Set(["no"]),
	man_made: new Set(["no", "cutline", "embankment", "pipeline"]),
	natural: new Set(["no", "coastline", "cliff", "ridge", "arete", "tree_row"]),
} as const

/**
 * Determine if a way is an area based on its tags and nodes.
 *
 * This function implements the logic described in the OSM wiki:
 * https://wiki.openstreetmap.org/wiki/Key:area
 * https://wiki.openstreetmap.org/wiki/Overpass_turbo/Polygon_Features
 *
 * @param refs - The node references of the way.
 * @param tags - The tags of the way.
 * @returns `true` if the way is an area, `false` otherwise.
 */
export function wayIsArea(refs: number[], tags?: OsmTags): boolean {
	if (refs.length < 3) return false
	if (refs[0] !== refs[refs.length - 1]) return false
	if (!tags) return false

	// 1. Explicit override
	if ("area" in tags) return tags.area !== "no"

	// 2. Tags that count if value is NOT "no"
	for (const key of IMPLIED_ANY_VALUE_BUT_NO) {
		const v = tags[key]
		if (v && v !== "no") return true
	}

	// 3. Tags that are area only for INCLUDED values
	for (const [key, included] of Object.entries(INCLUDED_VALUE_TAGS)) {
		const v = tags[key]
		if (v && included.has(v)) return true
	}

	// 4. Tags that are area unless value is excluded
	for (const [key, excluded] of Object.entries(EXCLUDED_VALUE_TAGS)) {
		const v = tags[key]
		if (v && !excluded.has(v)) return true
	}

	return false
}
