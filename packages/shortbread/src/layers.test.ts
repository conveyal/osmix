import { describe, expect, it } from "bun:test"
import {
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
	matchTags,
	matchWater,
	matchWaterLines,
} from "./layers"

describe("Shortbread Layer Matchers", () => {
	describe("matchWater", () => {
		it("matches natural=water", () => {
			const result = matchWater({ natural: "water" })
			expect(result).toBeDefined()
			expect(result?.kind).toBe("water")
		})

		it("matches natural=water with water=lake", () => {
			const result = matchWater({ natural: "water", water: "lake" })
			expect(result?.kind).toBe("lake")
		})

		it("matches natural=water with water=reservoir", () => {
			const result = matchWater({ natural: "water", water: "reservoir" })
			expect(result?.kind).toBe("reservoir")
		})

		it("matches waterway=riverbank", () => {
			const result = matchWater({ waterway: "riverbank" })
			expect(result?.kind).toBe("river")
		})

		it("matches landuse=reservoir", () => {
			const result = matchWater({ landuse: "reservoir" })
			expect(result?.kind).toBe("reservoir")
		})

		it("matches leisure=swimming_pool", () => {
			const result = matchWater({ leisure: "swimming_pool" })
			expect(result?.kind).toBe("swimming_pool")
		})

		it("extracts intermittent property", () => {
			const result = matchWater({ natural: "water", intermittent: "yes" })
			expect(result?.intermittent).toBe(true)
		})

		it("extracts name properties", () => {
			const result = matchWater({
				natural: "water",
				name: "Lake Tahoe",
				"name:en": "Lake Tahoe",
				"name:de": "Tahoesee",
			})
			expect(result?.name).toBe("Lake Tahoe")
			expect(result?.name_en).toBe("Lake Tahoe")
			expect(result?.name_de).toBe("Tahoesee")
		})

		it("returns null for non-water features", () => {
			const result = matchWater({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchWaterLines", () => {
		it("matches waterway=river", () => {
			const result = matchWaterLines({ waterway: "river" })
			expect(result?.kind).toBe("river")
		})

		it("matches waterway=stream", () => {
			const result = matchWaterLines({ waterway: "stream" })
			expect(result?.kind).toBe("stream")
		})

		it("matches waterway=canal", () => {
			const result = matchWaterLines({ waterway: "canal" })
			expect(result?.kind).toBe("canal")
		})

		it("extracts tunnel property", () => {
			const result = matchWaterLines({ waterway: "stream", tunnel: "yes" })
			expect(result?.tunnel).toBe(true)
		})

		it("extracts bridge property", () => {
			const result = matchWaterLines({ waterway: "river", bridge: "yes" })
			expect(result?.bridge).toBe(true)
		})

		it("returns null for non-waterway", () => {
			const result = matchWaterLines({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchLand", () => {
		it("matches natural=wood", () => {
			const result = matchLand({ natural: "wood" })
			expect(result?.kind).toBe("wood")
		})

		it("matches landuse=residential", () => {
			const result = matchLand({ landuse: "residential" })
			expect(result?.kind).toBe("residential")
		})

		it("matches landuse=industrial", () => {
			const result = matchLand({ landuse: "industrial" })
			expect(result?.kind).toBe("industrial")
		})

		it("matches landuse=farmland", () => {
			const result = matchLand({ landuse: "farmland" })
			expect(result?.kind).toBe("farmland")
		})

		it("matches natural=beach", () => {
			const result = matchLand({ natural: "beach" })
			expect(result?.kind).toBe("beach")
		})

		it("returns null for non-land features", () => {
			const result = matchLand({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchSites", () => {
		it("matches tourism=zoo", () => {
			const result = matchSites({ tourism: "zoo" })
			expect(result?.kind).toBe("zoo")
		})

		it("matches leisure=park", () => {
			const result = matchSites({ leisure: "park" })
			expect(result?.kind).toBe("park")
		})

		it("matches amenity=hospital", () => {
			const result = matchSites({ amenity: "hospital" })
			expect(result?.kind).toBe("hospital")
		})

		it("matches aeroway=aerodrome", () => {
			const result = matchSites({ aeroway: "aerodrome" })
			expect(result?.kind).toBe("aerodrome")
		})

		it("returns null for non-site features", () => {
			const result = matchSites({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchBuildings", () => {
		it("matches building=yes", () => {
			const result = matchBuildings({ building: "yes" })
			expect(result?.kind).toBe("building")
		})

		it("matches building=residential", () => {
			const result = matchBuildings({ building: "residential" })
			expect(result?.kind).toBe("building")
		})

		it("extracts height properties", () => {
			const result = matchBuildings({
				building: "yes",
				height: "20",
				min_height: "5",
			})
			expect(result?.height).toBe(20)
			expect(result?.min_height).toBe(5)
		})

		it("extracts building levels", () => {
			const result = matchBuildings({
				building: "yes",
				"building:levels": "5",
				"building:min_level": "1",
			})
			expect(result?.levels).toBe(5)
			expect(result?.min_levels).toBe(1)
		})

		it("returns null for building=no", () => {
			const result = matchBuildings({ building: "no" })
			expect(result).toBeNull()
		})

		it("returns null for non-building features", () => {
			const result = matchBuildings({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchStreets", () => {
		it("matches highway=motorway", () => {
			const result = matchStreets({ highway: "motorway" })
			expect(result?.kind).toBe("motorway")
		})

		it("matches highway=primary", () => {
			const result = matchStreets({ highway: "primary" })
			expect(result?.kind).toBe("primary")
		})

		it("matches highway=residential", () => {
			const result = matchStreets({ highway: "residential" })
			expect(result?.kind).toBe("residential")
		})

		it("matches highway=footway", () => {
			const result = matchStreets({ highway: "footway" })
			expect(result?.kind).toBe("footway")
		})

		it("extracts surface property", () => {
			const result = matchStreets({ highway: "primary", surface: "asphalt" })
			expect(result?.surface).toBe("asphalt")
		})

		it("extracts oneway property", () => {
			const result = matchStreets({ highway: "primary", oneway: "yes" })
			expect(result?.oneway).toBe(true)
		})

		it("extracts tunnel and bridge properties", () => {
			const tunnel = matchStreets({ highway: "primary", tunnel: "yes" })
			expect(tunnel?.tunnel).toBe(true)

			const bridge = matchStreets({ highway: "primary", bridge: "yes" })
			expect(bridge?.bridge).toBe(true)
		})

		it("extracts ref and maxspeed", () => {
			const result = matchStreets({
				highway: "primary",
				ref: "A1",
				maxspeed: "50",
			})
			expect(result?.ref).toBe("A1")
			expect(result?.maxspeed).toBe(50)
		})

		it("returns null for non-highway features", () => {
			const result = matchStreets({ building: "yes" })
			expect(result).toBeNull()
		})
	})

	describe("matchPois", () => {
		it("matches amenity=restaurant", () => {
			const result = matchPois({ amenity: "restaurant" })
			expect(result?.kind).toBe("restaurant")
		})

		it("matches tourism=hotel", () => {
			const result = matchPois({ tourism: "hotel" })
			expect(result?.kind).toBe("hotel")
		})

		it("matches shop=supermarket", () => {
			const result = matchPois({ shop: "supermarket" })
			expect(result?.kind).toBe("supermarket")
		})

		it("matches natural=peak", () => {
			const result = matchPois({ natural: "peak" })
			expect(result?.kind).toBe("peak")
		})

		it("matches historic=castle", () => {
			const result = matchPois({ historic: "castle" })
			expect(result?.kind).toBe("castle")
		})

		it("matches railway=station", () => {
			const result = matchPois({ railway: "station" })
			expect(result?.kind).toBe("railway_station")
		})

		it("matches highway=bus_stop", () => {
			const result = matchPois({ highway: "bus_stop" })
			expect(result?.kind).toBe("bus_stop")
		})

		it("returns null for non-POI features", () => {
			const result = matchPois({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchPlaces", () => {
		it("matches place=city", () => {
			const result = matchPlaces({ place: "city" })
			expect(result?.kind).toBe("city")
		})

		it("matches place=town", () => {
			const result = matchPlaces({ place: "town" })
			expect(result?.kind).toBe("town")
		})

		it("matches place=village", () => {
			const result = matchPlaces({ place: "village" })
			expect(result?.kind).toBe("village")
		})

		it("extracts population", () => {
			const result = matchPlaces({ place: "city", population: "1000000" })
			expect(result?.population).toBe(1000000)
		})

		it("extracts capital=yes as boolean", () => {
			const result = matchPlaces({ place: "city", capital: "yes" })
			expect(result?.capital).toBe(true)
		})

		it("extracts capital with admin level", () => {
			const result = matchPlaces({ place: "city", capital: "4" })
			expect(result?.capital).toBe("4")
		})

		it("returns null for non-place features", () => {
			const result = matchPlaces({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchBoundary", () => {
		it("matches boundary=administrative", () => {
			const result = matchBoundary({ boundary: "administrative" })
			expect(result?.kind).toBe("administrative")
		})

		it("matches boundary=protected_area", () => {
			const result = matchBoundary({ boundary: "protected_area" })
			expect(result?.kind).toBe("protected_area")
		})

		it("classifies national boundaries (admin_level 2)", () => {
			const result = matchBoundary({
				boundary: "administrative",
				admin_level: "2",
			})
			expect(result?.kind).toBe("national")
			expect(result?.admin_level).toBe(2)
		})

		it("classifies regional boundaries (admin_level 4)", () => {
			const result = matchBoundary({
				boundary: "administrative",
				admin_level: "4",
			})
			expect(result?.kind).toBe("regional")
		})

		it("classifies local boundaries (admin_level 6+)", () => {
			const result = matchBoundary({
				boundary: "administrative",
				admin_level: "6",
			})
			expect(result?.kind).toBe("local")
		})

		it("returns null for non-boundary features", () => {
			const result = matchBoundary({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchAddresses", () => {
		it("matches addr:housenumber", () => {
			const result = matchAddresses({ "addr:housenumber": "42" })
			expect(result?.kind).toBe("address")
			expect(result?.housenumber).toBe("42")
		})

		it("extracts all address parts", () => {
			const result = matchAddresses({
				"addr:housenumber": "42",
				"addr:street": "Main Street",
				"addr:postcode": "12345",
				"addr:city": "Springfield",
			})
			expect(result?.housenumber).toBe("42")
			expect(result?.street).toBe("Main Street")
			expect(result?.postcode).toBe("12345")
			expect(result?.city).toBe("Springfield")
		})

		it("returns null without housenumber", () => {
			const result = matchAddresses({ "addr:street": "Main Street" })
			expect(result).toBeNull()
		})
	})

	describe("matchPublicTransport", () => {
		it("matches railway=rail", () => {
			const result = matchPublicTransport({ railway: "rail" })
			expect(result?.kind).toBe("railway")
		})

		it("matches railway=subway", () => {
			const result = matchPublicTransport({ railway: "subway" })
			expect(result?.kind).toBe("subway")
		})

		it("matches route=bus", () => {
			const result = matchPublicTransport({ route: "bus" })
			expect(result?.kind).toBe("bus")
		})

		it("returns null for non-public transport", () => {
			const result = matchPublicTransport({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchAerialways", () => {
		it("matches aerialway=cable_car", () => {
			const result = matchAerialways({ aerialway: "cable_car" })
			expect(result?.kind).toBe("cable_car")
		})

		it("matches aerialway=gondola", () => {
			const result = matchAerialways({ aerialway: "gondola" })
			expect(result?.kind).toBe("gondola")
		})

		it("matches aerialway=chair_lift", () => {
			const result = matchAerialways({ aerialway: "chair_lift" })
			expect(result?.kind).toBe("chair_lift")
		})

		it("returns null for non-aerialway", () => {
			const result = matchAerialways({ highway: "primary" })
			expect(result).toBeNull()
		})
	})

	describe("matchFerries", () => {
		it("matches route=ferry", () => {
			const result = matchFerries({ route: "ferry" })
			expect(result?.kind).toBe("ferry")
		})

		it("returns null for non-ferry routes", () => {
			const result = matchFerries({ route: "bus" })
			expect(result).toBeNull()
		})
	})

	describe("matchBridges", () => {
		it("matches man_made=bridge", () => {
			const result = matchBridges({ man_made: "bridge" })
			expect(result?.kind).toBe("bridge")
		})

		it("returns null for non-bridge", () => {
			const result = matchBridges({ man_made: "tower" })
			expect(result).toBeNull()
		})
	})

	describe("matchDams", () => {
		it("matches waterway=dam", () => {
			const result = matchDams({ waterway: "dam" })
			expect(result?.kind).toBe("dam")
		})

		it("returns null for non-dam waterways", () => {
			const result = matchDams({ waterway: "river" })
			expect(result).toBeNull()
		})
	})

	describe("matchPiers", () => {
		it("matches man_made=pier", () => {
			const result = matchPiers({ man_made: "pier" })
			expect(result?.kind).toBe("pier")
		})

		it("returns null for non-pier", () => {
			const result = matchPiers({ man_made: "bridge" })
			expect(result).toBeNull()
		})
	})

	describe("matchTags", () => {
		it("matches point geometry to POI layer", () => {
			const result = matchTags({ amenity: "restaurant" }, "Point")
			expect(result?.layer.name).toBe("pois")
			expect(result?.properties.kind).toBe("restaurant")
		})

		it("matches point geometry to places layer", () => {
			const result = matchTags({ place: "city" }, "Point")
			expect(result?.layer.name).toBe("places")
		})

		it("matches line geometry to streets layer", () => {
			const result = matchTags({ highway: "primary" }, "LineString")
			expect(result?.layer.name).toBe("streets")
		})

		it("matches polygon geometry to buildings layer", () => {
			const result = matchTags({ building: "yes" }, "Polygon")
			expect(result?.layer.name).toBe("buildings")
		})

		it("matches polygon geometry to water layer", () => {
			const result = matchTags({ natural: "water" }, "Polygon")
			expect(result?.layer.name).toBe("water")
		})

		it("returns null when no layer matches", () => {
			const result = matchTags({ unknown: "tag" }, "Point")
			expect(result).toBeNull()
		})
	})
})
