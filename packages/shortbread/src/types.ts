/**
 * Shortbread Vector Tile Schema Types
 * Based on https://shortbread-tiles.org/schema/1.0/
 */

import type { OsmTags, XY } from "@osmix/shared/types"

export type ShortbreadLayerName =
	| "water"
	| "water_lines"
	| "water_lines_labels"
	| "land"
	| "sites"
	| "buildings"
	| "addresses"
	| "streets"
	| "street_labels"
	| "street_labels_points"
	| "aerialways"
	| "public_transport"
	| "bridges"
	| "dams"
	| "piers"
	| "ferries"
	| "boundary_labels"
	| "boundary_lines"
	| "places"
	| "pois"

export type ShortbreadGeometryType = "Point" | "LineString" | "Polygon"

/**
 * Feature classification for water layer
 */
export type WaterKind =
	| "water"
	| "ocean"
	| "river"
	| "lake"
	| "reservoir"
	| "basin"
	| "dock"
	| "swimming_pool"

/**
 * Feature classification for water_lines layer
 */
export type WaterLineKind =
	| "river"
	| "canal"
	| "stream"
	| "ditch"
	| "drain"
	| "dam"

/**
 * Feature classification for land layer
 */
export type LandKind =
	| "forest"
	| "grass"
	| "wood"
	| "farmland"
	| "residential"
	| "commercial"
	| "industrial"
	| "retail"
	| "railway"
	| "cemetery"
	| "allotments"
	| "brownfield"
	| "greenfield"
	| "heath"
	| "meadow"
	| "orchard"
	| "scrub"
	| "vineyard"
	| "quarry"
	| "landfill"
	| "military"
	| "construction"
	| "recreation_ground"
	| "village_green"
	| "winter_sports"
	| "sand"
	| "beach"
	| "bare_rock"
	| "scree"
	| "glacier"
	| "wetland"
	| "mud"

/**
 * Feature classification for sites layer
 */
export type SiteKind =
	| "attraction"
	| "zoo"
	| "theme_park"
	| "park"
	| "garden"
	| "playground"
	| "sports_centre"
	| "stadium"
	| "pitch"
	| "golf_course"
	| "swimming_pool"
	| "water_park"
	| "hospital"
	| "university"
	| "school"
	| "college"
	| "kindergarten"
	| "parking"
	| "fuel"
	| "bus_station"
	| "railway_station"
	| "aerodrome"
	| "helipad"
	| "marina"
	| "prison"
	| "place_of_worship"
	| "cemetery"
	| "shopping"

/**
 * Street classification kinds
 */
export type StreetKind =
	| "motorway"
	| "motorway_link"
	| "trunk"
	| "trunk_link"
	| "primary"
	| "primary_link"
	| "secondary"
	| "secondary_link"
	| "tertiary"
	| "tertiary_link"
	| "unclassified"
	| "residential"
	| "living_street"
	| "pedestrian"
	| "service"
	| "track"
	| "footway"
	| "path"
	| "cycleway"
	| "steps"
	| "bridleway"
	| "construction"
	| "raceway"

/**
 * POI classification kinds
 */
export type PoiKind =
	| "restaurant"
	| "cafe"
	| "fast_food"
	| "bar"
	| "pub"
	| "biergarten"
	| "food_court"
	| "ice_cream"
	| "hotel"
	| "motel"
	| "hostel"
	| "guest_house"
	| "camp_site"
	| "caravan_site"
	| "alpine_hut"
	| "wilderness_hut"
	| "supermarket"
	| "convenience"
	| "bakery"
	| "butcher"
	| "greengrocer"
	| "kiosk"
	| "mall"
	| "department_store"
	| "clothes"
	| "shoes"
	| "sports"
	| "furniture"
	| "electronics"
	| "hardware"
	| "books"
	| "stationery"
	| "bicycle"
	| "car"
	| "hairdresser"
	| "beauty"
	| "laundry"
	| "dry_cleaning"
	| "optician"
	| "pharmacy"
	| "hospital"
	| "clinic"
	| "doctors"
	| "dentist"
	| "veterinary"
	| "bank"
	| "atm"
	| "post_office"
	| "library"
	| "theatre"
	| "cinema"
	| "museum"
	| "gallery"
	| "community_centre"
	| "arts_centre"
	| "nightclub"
	| "casino"
	| "stadium"
	| "sports_centre"
	| "swimming_pool"
	| "water_park"
	| "fitness_centre"
	| "golf_course"
	| "pitch"
	| "playground"
	| "park"
	| "garden"
	| "zoo"
	| "theme_park"
	| "attraction"
	| "viewpoint"
	| "information"
	| "school"
	| "kindergarten"
	| "college"
	| "university"
	| "place_of_worship"
	| "fuel"
	| "car_wash"
	| "car_repair"
	| "bicycle_parking"
	| "bicycle_rental"
	| "parking"
	| "bus_stop"
	| "bus_station"
	| "tram_stop"
	| "subway_entrance"
	| "railway_station"
	| "halt"
	| "aerodrome"
	| "helipad"
	| "ferry_terminal"
	| "taxi"
	| "charging_station"
	| "toilet"
	| "drinking_water"
	| "bench"
	| "shelter"
	| "waste_basket"
	| "recycling"
	| "post_box"
	| "telephone"
	| "fire_station"
	| "police"
	| "townhall"
	| "embassy"
	| "courthouse"
	| "prison"
	| "marketplace"
	| "peak"
	| "volcano"
	| "saddle"
	| "spring"
	| "cave_entrance"
	| "tower"
	| "lighthouse"
	| "windmill"
	| "watermill"
	| "monument"
	| "memorial"
	| "wayside_cross"
	| "wayside_shrine"
	| "castle"
	| "ruins"
	| "archaeological_site"
	| "city_gate"

/**
 * Place classification kinds
 */
export type PlaceKind =
	| "continent"
	| "country"
	| "state"
	| "region"
	| "county"
	| "city"
	| "town"
	| "village"
	| "hamlet"
	| "suburb"
	| "neighbourhood"
	| "isolated_dwelling"
	| "farm"
	| "island"
	| "islet"
	| "locality"

/**
 * Public transport classification kinds
 */
export type PublicTransportKind =
	| "railway"
	| "light_rail"
	| "subway"
	| "tram"
	| "monorail"
	| "funicular"
	| "bus"

/**
 * Aerialway classification kinds
 */
export type AerialwayKind =
	| "cable_car"
	| "gondola"
	| "chair_lift"
	| "mixed_lift"
	| "drag_lift"
	| "t-bar"
	| "j-bar"
	| "platter"
	| "rope_tow"
	| "magic_carpet"
	| "zip_line"

/**
 * Boundary classification kinds
 */
export type BoundaryKind =
	| "administrative"
	| "national"
	| "regional"
	| "local"
	| "protected_area"

/**
 * Base properties for all Shortbread features
 */
export interface ShortbreadBaseProperties {
	kind: string
	name?: string
	name_en?: string
	name_de?: string
}

/**
 * Water layer properties
 */
export interface WaterProperties extends ShortbreadBaseProperties {
	kind: WaterKind
	intermittent?: boolean
}

/**
 * Water lines layer properties
 */
export interface WaterLineProperties extends ShortbreadBaseProperties {
	kind: WaterLineKind
	intermittent?: boolean
	tunnel?: boolean
	bridge?: boolean
}

/**
 * Land layer properties
 */
export interface LandProperties extends ShortbreadBaseProperties {
	kind: LandKind
}

/**
 * Sites layer properties
 */
export interface SiteProperties extends ShortbreadBaseProperties {
	kind: SiteKind
}

/**
 * Streets layer properties
 */
export interface StreetProperties extends ShortbreadBaseProperties {
	kind: StreetKind
	surface?: string
	oneway?: boolean
	tunnel?: boolean
	bridge?: boolean
	layer?: number
	ref?: string
	maxspeed?: number
	bicycle?: string
	foot?: string
}

/**
 * Buildings layer properties
 */
export interface BuildingProperties extends ShortbreadBaseProperties {
	kind: "building"
	height?: number
	min_height?: number
	levels?: number
	min_levels?: number
}

/**
 * POI layer properties
 */
export interface PoiProperties extends ShortbreadBaseProperties {
	kind: PoiKind
	subkind?: string
}

/**
 * Places layer properties
 */
export interface PlaceProperties extends ShortbreadBaseProperties {
	kind: PlaceKind
	population?: number
	capital?: boolean | string
}

/**
 * Boundary layer properties
 */
export interface BoundaryProperties extends ShortbreadBaseProperties {
	kind: BoundaryKind
	admin_level?: number
}

/**
 * Addresses layer properties
 */
export interface AddressProperties extends ShortbreadBaseProperties {
	kind: "address"
	housenumber?: string
	street?: string
	postcode?: string
	city?: string
}

/**
 * Public transport layer properties
 */
export interface PublicTransportProperties extends ShortbreadBaseProperties {
	kind: PublicTransportKind
}

/**
 * Aerialway layer properties
 */
export interface AerialwayProperties extends ShortbreadBaseProperties {
	kind: AerialwayKind
}

/**
 * Ferry layer properties
 */
export interface FerryProperties extends ShortbreadBaseProperties {
	kind: "ferry"
}

/**
 * Bridge layer properties
 */
export interface BridgeProperties extends ShortbreadBaseProperties {
	kind: "bridge"
}

/**
 * Dam layer properties
 */
export interface DamProperties extends ShortbreadBaseProperties {
	kind: "dam"
}

/**
 * Pier layer properties
 */
export interface PierProperties extends ShortbreadBaseProperties {
	kind: "pier"
}

/**
 * Union type for all Shortbread properties
 */
export type ShortbreadProperties =
	| WaterProperties
	| WaterLineProperties
	| LandProperties
	| SiteProperties
	| StreetProperties
	| BuildingProperties
	| PoiProperties
	| PlaceProperties
	| BoundaryProperties
	| AddressProperties
	| PublicTransportProperties
	| AerialwayProperties
	| FerryProperties
	| BridgeProperties
	| DamProperties
	| PierProperties

/**
 * A classified Shortbread feature ready for tile encoding
 */
export interface ShortbreadFeature {
	id: number
	layer: ShortbreadLayerName
	geometryType: ShortbreadGeometryType
	geometry: XY[][]
	properties: ShortbreadProperties
}

/**
 * Layer filter function type
 */
export type LayerMatcher = (tags: OsmTags) => ShortbreadProperties | null

/**
 * Layer definition
 */
export interface ShortbreadLayerDefinition {
	name: ShortbreadLayerName
	geometryTypes: ShortbreadGeometryType[]
	match: LayerMatcher
}
