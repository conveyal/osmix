/**
 * Shortbread Layer Definitions
 * Defines how OSM tags map to Shortbread layers and properties
 * Based on https://shortbread-tiles.org/schema/1.0/
 */

import type { OsmTags } from "@osmix/shared/types"
import type {
	AerialwayKind,
	AerialwayProperties,
	AddressProperties,
	BoundaryKind,
	BoundaryProperties,
	BridgeProperties,
	BuildingProperties,
	DamProperties,
	FerryProperties,
	LandKind,
	LandProperties,
	PierProperties,
	PlaceKind,
	PlaceProperties,
	PoiKind,
	PoiProperties,
	PublicTransportKind,
	PublicTransportProperties,
	ShortbreadBaseProperties,
	ShortbreadLayerDefinition,
	ShortbreadProperties,
	SiteKind,
	SiteProperties,
	StreetKind,
	StreetProperties,
	WaterKind,
	WaterLineKind,
	WaterLineProperties,
	WaterProperties,
} from "./types"

/**
 * Get a string tag value from OsmTags
 */
function getTag(tags: OsmTags, key: string): string | undefined {
	const value = tags[key]
	if (value === undefined) return undefined
	return String(value)
}

/**
 * Extract common name properties from OSM tags
 */
function extractNames(
	tags: OsmTags,
): Pick<ShortbreadBaseProperties, "name" | "name_en" | "name_de"> {
	return {
		name: getTag(tags, "name"),
		name_en: getTag(tags, "name:en"),
		name_de: getTag(tags, "name:de"),
	}
}

/**
 * Parse a numeric value from a tag
 */
function parseNumber(value: string | number | undefined): number | undefined {
	if (value === undefined) return undefined
	if (typeof value === "number") return value
	const parsed = Number.parseFloat(value)
	return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Parse boolean value from a tag
 */
function parseBoolean(value: string | number | undefined): boolean | undefined {
	if (value === undefined) return undefined
	const strValue = String(value)
	if (strValue === "yes" || strValue === "true" || strValue === "1") return true
	if (strValue === "no" || strValue === "false" || strValue === "0")
		return false
	return undefined
}

// ============================================================================
// Water Layer
// ============================================================================

const WATER_KIND_MAP: Record<string, WaterKind> = {
	water: "water",
	ocean: "ocean",
	sea: "ocean",
	riverbank: "river",
	river: "river",
	lake: "lake",
	reservoir: "reservoir",
	basin: "basin",
	dock: "dock",
	swimming_pool: "swimming_pool",
}

function matchWater(tags: OsmTags): WaterProperties | null {
	const natural = getTag(tags, "natural")
	const waterway = getTag(tags, "waterway")
	const landuse = getTag(tags, "landuse")
	const leisure = getTag(tags, "leisure")
	const water = getTag(tags, "water")

	let kind: WaterKind | null = null

	if (natural === "water") {
		kind = WATER_KIND_MAP[water ?? "water"] ?? "water"
	} else if (waterway === "riverbank" || waterway === "dock") {
		kind = WATER_KIND_MAP[waterway] ?? "water"
	} else if (landuse === "reservoir" || landuse === "basin") {
		kind = WATER_KIND_MAP[landuse] ?? "water"
	} else if (leisure === "swimming_pool") {
		kind = "swimming_pool"
	}

	if (!kind) return null

	return {
		kind,
		intermittent: parseBoolean(tags["intermittent"]),
		...extractNames(tags),
	}
}

// ============================================================================
// Water Lines Layer
// ============================================================================

const WATER_LINE_KIND_MAP: Record<string, WaterLineKind> = {
	river: "river",
	canal: "canal",
	stream: "stream",
	ditch: "ditch",
	drain: "drain",
	dam: "dam",
}

function matchWaterLines(tags: OsmTags): WaterLineProperties | null {
	const waterway = getTag(tags, "waterway")

	if (!waterway) return null

	const kind = WATER_LINE_KIND_MAP[waterway]
	if (!kind) return null

	return {
		kind,
		intermittent: parseBoolean(tags["intermittent"]),
		tunnel: parseBoolean(tags["tunnel"]),
		bridge: parseBoolean(tags["bridge"]),
		...extractNames(tags),
	}
}

// ============================================================================
// Land Layer
// ============================================================================

const LAND_KIND_MAP: Record<string, LandKind> = {
	// Natural
	wood: "wood",
	forest: "forest",
	grassland: "grass",
	grass: "grass",
	heath: "heath",
	scrub: "scrub",
	wetland: "wetland",
	mud: "mud",
	beach: "beach",
	sand: "sand",
	bare_rock: "bare_rock",
	scree: "scree",
	glacier: "glacier",
	// Landuse
	residential: "residential",
	commercial: "commercial",
	industrial: "industrial",
	retail: "retail",
	railway: "railway",
	farmland: "farmland",
	cemetery: "cemetery",
	allotments: "allotments",
	brownfield: "brownfield",
	greenfield: "greenfield",
	meadow: "meadow",
	orchard: "orchard",
	vineyard: "vineyard",
	quarry: "quarry",
	landfill: "landfill",
	military: "military",
	construction: "construction",
	recreation_ground: "recreation_ground",
	village_green: "village_green",
	winter_sports: "winter_sports",
}

function matchLand(tags: OsmTags): LandProperties | null {
	const natural = getTag(tags, "natural")
	const landuse = getTag(tags, "landuse")
	const leisure = getTag(tags, "leisure")

	let kind: LandKind | null = null

	if (natural && LAND_KIND_MAP[natural]) {
		kind = LAND_KIND_MAP[natural]!
	} else if (landuse && LAND_KIND_MAP[landuse]) {
		kind = LAND_KIND_MAP[landuse]!
	} else if (landuse === "forest") {
		kind = "forest"
	} else if (leisure === "recreation_ground") {
		kind = "recreation_ground"
	}

	if (!kind) return null

	return {
		kind,
		...extractNames(tags),
	}
}

// ============================================================================
// Sites Layer
// ============================================================================

const SITE_KIND_MAP: Record<string, SiteKind> = {
	// Tourism
	attraction: "attraction",
	zoo: "zoo",
	theme_park: "theme_park",
	// Leisure
	park: "park",
	garden: "garden",
	playground: "playground",
	sports_centre: "sports_centre",
	stadium: "stadium",
	pitch: "pitch",
	golf_course: "golf_course",
	swimming_pool: "swimming_pool",
	water_park: "water_park",
	marina: "marina",
	// Amenity
	hospital: "hospital",
	university: "university",
	school: "school",
	college: "college",
	kindergarten: "kindergarten",
	parking: "parking",
	bus_station: "bus_station",
	prison: "prison",
	place_of_worship: "place_of_worship",
	// Aeroway
	aerodrome: "aerodrome",
	helipad: "helipad",
}

function matchSites(tags: OsmTags): SiteProperties | null {
	const tourism = getTag(tags, "tourism")
	const leisure = getTag(tags, "leisure")
	const amenity = getTag(tags, "amenity")
	const aeroway = getTag(tags, "aeroway")
	const landuse = getTag(tags, "landuse")
	const railway = getTag(tags, "railway")
	const shop = getTag(tags, "shop")

	let kind: SiteKind | null = null

	if (tourism && SITE_KIND_MAP[tourism]) {
		kind = SITE_KIND_MAP[tourism]!
	} else if (leisure && SITE_KIND_MAP[leisure]) {
		kind = SITE_KIND_MAP[leisure]!
	} else if (amenity && SITE_KIND_MAP[amenity]) {
		kind = SITE_KIND_MAP[amenity]!
	} else if (aeroway && SITE_KIND_MAP[aeroway]) {
		kind = SITE_KIND_MAP[aeroway]!
	} else if (railway === "station") {
		kind = "railway_station"
	} else if (amenity === "fuel") {
		kind = "fuel"
	} else if (landuse === "cemetery") {
		kind = "cemetery"
	} else if (shop === "mall" || shop === "shopping_centre") {
		kind = "shopping"
	}

	if (!kind) return null

	return {
		kind,
		...extractNames(tags),
	}
}

// ============================================================================
// Buildings Layer
// ============================================================================

function matchBuildings(tags: OsmTags): BuildingProperties | null {
	const building = getTag(tags, "building")

	if (!building || building === "no") return null

	return {
		kind: "building",
		height: parseNumber(tags["height"]),
		min_height: parseNumber(tags["min_height"]),
		levels: parseNumber(tags["building:levels"]),
		min_levels: parseNumber(tags["building:min_level"]),
		...extractNames(tags),
	}
}

// ============================================================================
// Streets Layer
// ============================================================================

const STREET_KIND_MAP: Record<string, StreetKind> = {
	motorway: "motorway",
	motorway_link: "motorway_link",
	trunk: "trunk",
	trunk_link: "trunk_link",
	primary: "primary",
	primary_link: "primary_link",
	secondary: "secondary",
	secondary_link: "secondary_link",
	tertiary: "tertiary",
	tertiary_link: "tertiary_link",
	unclassified: "unclassified",
	residential: "residential",
	living_street: "living_street",
	pedestrian: "pedestrian",
	service: "service",
	track: "track",
	footway: "footway",
	path: "path",
	cycleway: "cycleway",
	steps: "steps",
	bridleway: "bridleway",
	construction: "construction",
	raceway: "raceway",
}

function matchStreets(tags: OsmTags): StreetProperties | null {
	const highway = getTag(tags, "highway")

	if (!highway) return null

	const kind = STREET_KIND_MAP[highway]
	if (!kind) return null

	return {
		kind,
		surface: getTag(tags, "surface"),
		oneway: parseBoolean(tags["oneway"]),
		tunnel: parseBoolean(tags["tunnel"]),
		bridge: parseBoolean(tags["bridge"]),
		layer: parseNumber(tags["layer"]),
		ref: getTag(tags, "ref"),
		maxspeed: parseNumber(tags["maxspeed"]),
		bicycle: getTag(tags, "bicycle"),
		foot: getTag(tags, "foot"),
		...extractNames(tags),
	}
}

// ============================================================================
// POIs Layer
// ============================================================================

const POI_AMENITY_MAP: Record<string, PoiKind> = {
	restaurant: "restaurant",
	cafe: "cafe",
	fast_food: "fast_food",
	bar: "bar",
	pub: "pub",
	biergarten: "biergarten",
	food_court: "food_court",
	ice_cream: "ice_cream",
	bank: "bank",
	atm: "atm",
	post_office: "post_office",
	library: "library",
	theatre: "theatre",
	cinema: "cinema",
	nightclub: "nightclub",
	casino: "casino",
	community_centre: "community_centre",
	arts_centre: "arts_centre",
	hospital: "hospital",
	clinic: "clinic",
	doctors: "doctors",
	dentist: "dentist",
	veterinary: "veterinary",
	pharmacy: "pharmacy",
	school: "school",
	kindergarten: "kindergarten",
	college: "college",
	university: "university",
	place_of_worship: "place_of_worship",
	fuel: "fuel",
	car_wash: "car_wash",
	car_repair: "car_repair",
	bicycle_parking: "bicycle_parking",
	bicycle_rental: "bicycle_rental",
	parking: "parking",
	bus_station: "bus_station",
	taxi: "taxi",
	charging_station: "charging_station",
	toilets: "toilet",
	drinking_water: "drinking_water",
	bench: "bench",
	shelter: "shelter",
	waste_basket: "waste_basket",
	recycling: "recycling",
	post_box: "post_box",
	telephone: "telephone",
	fire_station: "fire_station",
	police: "police",
	townhall: "townhall",
	embassy: "embassy",
	courthouse: "courthouse",
	prison: "prison",
	marketplace: "marketplace",
}

const POI_TOURISM_MAP: Record<string, PoiKind> = {
	hotel: "hotel",
	motel: "motel",
	hostel: "hostel",
	guest_house: "guest_house",
	camp_site: "camp_site",
	caravan_site: "caravan_site",
	alpine_hut: "alpine_hut",
	wilderness_hut: "wilderness_hut",
	museum: "museum",
	gallery: "gallery",
	zoo: "zoo",
	theme_park: "theme_park",
	attraction: "attraction",
	viewpoint: "viewpoint",
	information: "information",
}

const POI_SHOP_MAP: Record<string, PoiKind> = {
	supermarket: "supermarket",
	convenience: "convenience",
	bakery: "bakery",
	butcher: "butcher",
	greengrocer: "greengrocer",
	kiosk: "kiosk",
	mall: "mall",
	department_store: "department_store",
	clothes: "clothes",
	shoes: "shoes",
	sports: "sports",
	furniture: "furniture",
	electronics: "electronics",
	hardware: "hardware",
	books: "books",
	stationery: "stationery",
	bicycle: "bicycle",
	car: "car",
	hairdresser: "hairdresser",
	beauty: "beauty",
	laundry: "laundry",
	dry_cleaning: "dry_cleaning",
	optician: "optician",
}

const POI_LEISURE_MAP: Record<string, PoiKind> = {
	stadium: "stadium",
	sports_centre: "sports_centre",
	swimming_pool: "swimming_pool",
	water_park: "water_park",
	fitness_centre: "fitness_centre",
	golf_course: "golf_course",
	pitch: "pitch",
	playground: "playground",
	park: "park",
	garden: "garden",
}

const POI_NATURAL_MAP: Record<string, PoiKind> = {
	peak: "peak",
	volcano: "volcano",
	saddle: "saddle",
	spring: "spring",
	cave_entrance: "cave_entrance",
}

const POI_MAN_MADE_MAP: Record<string, PoiKind> = {
	tower: "tower",
	lighthouse: "lighthouse",
	windmill: "windmill",
	watermill: "watermill",
}

const POI_HISTORIC_MAP: Record<string, PoiKind> = {
	monument: "monument",
	memorial: "memorial",
	wayside_cross: "wayside_cross",
	wayside_shrine: "wayside_shrine",
	castle: "castle",
	ruins: "ruins",
	archaeological_site: "archaeological_site",
	city_gate: "city_gate",
}

function matchPois(tags: OsmTags): PoiProperties | null {
	const amenity = getTag(tags, "amenity")
	const tourism = getTag(tags, "tourism")
	const shop = getTag(tags, "shop")
	const leisure = getTag(tags, "leisure")
	const natural = getTag(tags, "natural")
	const manMade = getTag(tags, "man_made")
	const historic = getTag(tags, "historic")
	const railway = getTag(tags, "railway")
	const highway = getTag(tags, "highway")
	const aeroway = getTag(tags, "aeroway")

	let kind: PoiKind | null = null

	if (amenity && POI_AMENITY_MAP[amenity]) {
		kind = POI_AMENITY_MAP[amenity]!
	} else if (tourism && POI_TOURISM_MAP[tourism]) {
		kind = POI_TOURISM_MAP[tourism]!
	} else if (shop && POI_SHOP_MAP[shop]) {
		kind = POI_SHOP_MAP[shop]!
	} else if (leisure && POI_LEISURE_MAP[leisure]) {
		kind = POI_LEISURE_MAP[leisure]!
	} else if (natural && POI_NATURAL_MAP[natural]) {
		kind = POI_NATURAL_MAP[natural]!
	} else if (manMade && POI_MAN_MADE_MAP[manMade]) {
		kind = POI_MAN_MADE_MAP[manMade]!
	} else if (historic && POI_HISTORIC_MAP[historic]) {
		kind = POI_HISTORIC_MAP[historic]!
	} else if (railway === "station" || railway === "halt") {
		kind = railway === "station" ? "railway_station" : "halt"
	} else if (highway === "bus_stop") {
		kind = "bus_stop"
	} else if (railway === "tram_stop") {
		kind = "tram_stop"
	} else if (railway === "subway_entrance") {
		kind = "subway_entrance"
	} else if (aeroway === "aerodrome") {
		kind = "aerodrome"
	} else if (aeroway === "helipad") {
		kind = "helipad"
	} else if (amenity === "ferry_terminal") {
		kind = "ferry_terminal"
	}

	if (!kind) return null

	return {
		kind,
		...extractNames(tags),
	}
}

// ============================================================================
// Places Layer
// ============================================================================

const PLACE_KIND_MAP: Record<string, PlaceKind> = {
	continent: "continent",
	country: "country",
	state: "state",
	region: "region",
	county: "county",
	city: "city",
	town: "town",
	village: "village",
	hamlet: "hamlet",
	suburb: "suburb",
	neighbourhood: "neighbourhood",
	isolated_dwelling: "isolated_dwelling",
	farm: "farm",
	island: "island",
	islet: "islet",
	locality: "locality",
}

function matchPlaces(tags: OsmTags): PlaceProperties | null {
	const place = getTag(tags, "place")

	if (!place) return null

	const kind = PLACE_KIND_MAP[place]
	if (!kind) return null

	const capital = getTag(tags, "capital")
	let capitalValue: boolean | string | undefined
	if (capital === "yes" || capital === "true") {
		capitalValue = true
	} else if (capital && capital !== "no" && capital !== "false") {
		capitalValue = capital
	}

	return {
		kind,
		population: parseNumber(tags["population"]),
		capital: capitalValue,
		...extractNames(tags),
	}
}

// ============================================================================
// Boundary Layer
// ============================================================================

function matchBoundary(tags: OsmTags): BoundaryProperties | null {
	const boundary = getTag(tags, "boundary")
	const adminLevel = tags["admin_level"]

	if (boundary !== "administrative" && boundary !== "protected_area") {
		return null
	}

	let kind: BoundaryKind = "administrative"
	const level = parseNumber(adminLevel)

	if (boundary === "protected_area") {
		kind = "protected_area"
	} else if (level !== undefined) {
		if (level <= 2) {
			kind = "national"
		} else if (level <= 4) {
			kind = "regional"
		} else {
			kind = "local"
		}
	}

	return {
		kind,
		admin_level: level,
		...extractNames(tags),
	}
}

// ============================================================================
// Addresses Layer
// ============================================================================

function matchAddresses(tags: OsmTags): AddressProperties | null {
	const housenumber = getTag(tags, "addr:housenumber")
	const street = getTag(tags, "addr:street")

	// Need at least housenumber to be considered an address
	if (!housenumber) return null

	return {
		kind: "address",
		housenumber,
		street,
		postcode: getTag(tags, "addr:postcode"),
		city: getTag(tags, "addr:city"),
		...extractNames(tags),
	}
}

// ============================================================================
// Public Transport Layer
// ============================================================================

const PUBLIC_TRANSPORT_KIND_MAP: Record<string, PublicTransportKind> = {
	rail: "railway",
	light_rail: "light_rail",
	subway: "subway",
	tram: "tram",
	monorail: "monorail",
	funicular: "funicular",
}

function matchPublicTransport(tags: OsmTags): PublicTransportProperties | null {
	const railway = getTag(tags, "railway")
	const route = getTag(tags, "route")

	let kind: PublicTransportKind | null = null

	if (railway && PUBLIC_TRANSPORT_KIND_MAP[railway]) {
		kind = PUBLIC_TRANSPORT_KIND_MAP[railway]!
	} else if (route === "bus") {
		kind = "bus"
	} else if (route === "tram") {
		kind = "tram"
	} else if (route === "subway") {
		kind = "subway"
	} else if (route === "light_rail") {
		kind = "light_rail"
	} else if (route === "train" || route === "railway") {
		kind = "railway"
	}

	if (!kind) return null

	return {
		kind,
		...extractNames(tags),
	}
}

// ============================================================================
// Aerialways Layer
// ============================================================================

const AERIALWAY_KIND_MAP: Record<string, AerialwayKind> = {
	cable_car: "cable_car",
	gondola: "gondola",
	chair_lift: "chair_lift",
	mixed_lift: "mixed_lift",
	drag_lift: "drag_lift",
	"t-bar": "t-bar",
	"j-bar": "j-bar",
	platter: "platter",
	rope_tow: "rope_tow",
	magic_carpet: "magic_carpet",
	zip_line: "zip_line",
}

function matchAerialways(tags: OsmTags): AerialwayProperties | null {
	const aerialway = getTag(tags, "aerialway")

	if (!aerialway) return null

	const kind = AERIALWAY_KIND_MAP[aerialway]
	if (!kind) return null

	return {
		kind,
		...extractNames(tags),
	}
}

// ============================================================================
// Ferry Lines (mapped to ferries layer)
// ============================================================================

function matchFerries(tags: OsmTags): FerryProperties | null {
	const route = getTag(tags, "route")

	if (route !== "ferry") return null

	return {
		kind: "ferry",
		...extractNames(tags),
	}
}

// ============================================================================
// Bridges Layer (bridge areas)
// ============================================================================

function matchBridges(tags: OsmTags): BridgeProperties | null {
	const manMade = getTag(tags, "man_made")

	if (manMade !== "bridge") return null

	return {
		kind: "bridge",
		...extractNames(tags),
	}
}

// ============================================================================
// Dams Layer
// ============================================================================

function matchDams(tags: OsmTags): DamProperties | null {
	const waterway = getTag(tags, "waterway")

	if (waterway !== "dam") return null

	return {
		kind: "dam",
		...extractNames(tags),
	}
}

// ============================================================================
// Piers Layer
// ============================================================================

function matchPiers(tags: OsmTags): PierProperties | null {
	const manMade = getTag(tags, "man_made")

	if (manMade !== "pier") return null

	return {
		kind: "pier",
		...extractNames(tags),
	}
}

// ============================================================================
// Layer Definitions Export
// ============================================================================

/**
 * All Shortbread layer definitions with their matchers
 */
export const SHORTBREAD_LAYERS: ShortbreadLayerDefinition[] = [
	{
		name: "water",
		geometryTypes: ["Polygon"],
		match: matchWater,
	},
	{
		name: "water_lines",
		geometryTypes: ["LineString"],
		match: matchWaterLines,
	},
	{
		name: "water_lines_labels",
		geometryTypes: ["LineString"],
		match: matchWaterLines,
	},
	{
		name: "land",
		geometryTypes: ["Polygon"],
		match: matchLand,
	},
	{
		name: "sites",
		geometryTypes: ["Polygon"],
		match: matchSites,
	},
	{
		name: "buildings",
		geometryTypes: ["Polygon"],
		match: matchBuildings,
	},
	{
		name: "streets",
		geometryTypes: ["LineString"],
		match: matchStreets,
	},
	{
		name: "street_labels",
		geometryTypes: ["LineString"],
		match: matchStreets,
	},
	{
		name: "street_labels_points",
		geometryTypes: ["Point"],
		match: matchStreets,
	},
	{
		name: "pois",
		geometryTypes: ["Point"],
		match: matchPois,
	},
	{
		name: "places",
		geometryTypes: ["Point"],
		match: matchPlaces,
	},
	{
		name: "boundary_lines",
		geometryTypes: ["LineString"],
		match: matchBoundary,
	},
	{
		name: "boundary_labels",
		geometryTypes: ["Point"],
		match: matchBoundary,
	},
	{
		name: "addresses",
		geometryTypes: ["Point"],
		match: matchAddresses,
	},
	{
		name: "public_transport",
		geometryTypes: ["LineString"],
		match: matchPublicTransport,
	},
	{
		name: "aerialways",
		geometryTypes: ["LineString"],
		match: matchAerialways,
	},
	{
		name: "ferries",
		geometryTypes: ["LineString"],
		match: matchFerries,
	},
	{
		name: "bridges",
		geometryTypes: ["Polygon"],
		match: matchBridges,
	},
	{
		name: "dams",
		geometryTypes: ["LineString", "Polygon"],
		match: matchDams,
	},
	{
		name: "piers",
		geometryTypes: ["LineString", "Polygon"],
		match: matchPiers,
	},
]

/**
 * Get layer definitions by geometry type
 */
export function getLayersForGeometryType(
	geometryType: "Point" | "LineString" | "Polygon",
): ShortbreadLayerDefinition[] {
	return SHORTBREAD_LAYERS.filter((layer) =>
		layer.geometryTypes.includes(geometryType),
	)
}

/**
 * Match tags against all applicable layers for a geometry type
 * Returns the first matching layer's properties, or null if no match
 */
export function matchTags(
	tags: OsmTags,
	geometryType: "Point" | "LineString" | "Polygon",
): {
	layer: ShortbreadLayerDefinition
	properties: ShortbreadProperties
} | null {
	const layers = getLayersForGeometryType(geometryType)
	for (const layer of layers) {
		const properties = layer.match(tags)
		if (properties) {
			return { layer, properties }
		}
	}
	return null
}

// Export individual matchers for testing
export {
	matchAddresses,
	matchAerialways,
	matchBoundary,
	matchBridges,
	matchBuildings,
	matchDams,
	matchFerries,
	matchLand,
	matchPiers,
	matchPlaces,
	matchPois,
	matchPublicTransport,
	matchSites,
	matchStreets,
	matchWater,
	matchWaterLines,
}
