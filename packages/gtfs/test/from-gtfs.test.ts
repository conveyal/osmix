import { describe, expect, test } from "bun:test"
import {
	fromGtfs,
	GtfsArchive,
	GtfsOsmBuilder,
	routeTypeToOsmRoute,
	wheelchairBoardingToOsm,
} from "../src"
import { createGtfsZipWithoutShapes, createTestGtfsZip } from "./helpers"

describe("routeTypeToOsmRoute", () => {
	test("maps GTFS route types to OSM route values", () => {
		expect(routeTypeToOsmRoute("0")).toBe("tram")
		expect(routeTypeToOsmRoute("1")).toBe("subway")
		expect(routeTypeToOsmRoute("2")).toBe("train")
		expect(routeTypeToOsmRoute("3")).toBe("bus")
		expect(routeTypeToOsmRoute("4")).toBe("ferry")
		expect(routeTypeToOsmRoute("5")).toBe("tram")
		expect(routeTypeToOsmRoute("6")).toBe("aerialway")
		expect(routeTypeToOsmRoute("7")).toBe("funicular")
		expect(routeTypeToOsmRoute("11")).toBe("trolleybus")
		expect(routeTypeToOsmRoute("12")).toBe("train")
	})

	test("defaults to bus for unknown types", () => {
		expect(routeTypeToOsmRoute("99")).toBe("bus")
		expect(routeTypeToOsmRoute("")).toBe("bus")
	})
})

describe("wheelchairBoardingToOsm", () => {
	test("maps wheelchair boarding values", () => {
		expect(wheelchairBoardingToOsm("1")).toBe("yes")
		expect(wheelchairBoardingToOsm("2")).toBe("no")
		expect(wheelchairBoardingToOsm("0")).toBeUndefined()
		expect(wheelchairBoardingToOsm(undefined)).toBeUndefined()
	})
})

describe("GtfsArchive", () => {
	test("parses a GTFS zip file lazily", async () => {
		const zipData = await createTestGtfsZip()
		const archive = GtfsArchive.fromZip(zipData)

		// Check files are listed
		const files = archive.listFiles()
		expect(files).toContain("agency.txt")
		expect(files).toContain("stops.txt")
		expect(files).toContain("routes.txt")

		// Parse agencies on demand
		const agencies = await archive.agencies()
		expect(agencies.length).toBe(1)
		expect(agencies[0]?.agency_name).toBe("Test Transit")

		// Parse stops on demand
		const stops = await archive.stops()
		expect(stops.length).toBe(3)
		expect(stops[0]?.stop_name).toBe("Main St Station")

		// Parse routes on demand
		const routes = await archive.routes()
		expect(routes.length).toBe(1)
		expect(routes[0]?.route_short_name).toBe("1")
	})

	test("iterates stops without loading all at once", async () => {
		const zipData = await createTestGtfsZip()
		const archive = GtfsArchive.fromZip(zipData)

		const stops = []
		for await (const stop of archive.iterStops()) {
			stops.push(stop)
		}

		expect(stops.length).toBe(3)
		expect(stops[0]?.stop_name).toBe("Main St Station")
	})

	test("caches parsed data on repeated access", async () => {
		const zipData = await createTestGtfsZip()
		const archive = GtfsArchive.fromZip(zipData)

		const stops1 = await archive.stops()
		const stops2 = await archive.stops()

		// Should be the same cached array
		expect(stops1).toBe(stops2)
	})
})

describe("fromGtfs", () => {
	test("converts GTFS to OSM with shapes", async () => {
		const zipData = await createTestGtfsZip()
		const osm = await fromGtfs(zipData, { id: "test-transit" })

		// Should have stops as nodes
		expect(osm.nodes.size).toBeGreaterThanOrEqual(3)

		// Should have route as way
		expect(osm.ways.size).toBe(1)

		// Check node tags
		const stopNodes = []
		for (let i = 0; i < osm.nodes.size; i++) {
			const tags = osm.nodes.tags.getTags(i)
			if (tags?.["public_transport"]) {
				stopNodes.push({ index: i, tags })
			}
		}
		expect(stopNodes.length).toBe(3)

		// First stop should have correct tags
		const firstStop = stopNodes.find(
			(n) => n.tags?.["name"] === "Main St Station",
		)
		expect(firstStop).toBeDefined()
		expect(firstStop?.tags?.["ref"]).toBe("stop1")
		expect(firstStop?.tags?.["wheelchair"]).toBe("yes")

		// Check way tags
		const wayTags = osm.ways.tags.getTags(0)
		expect(wayTags?.["route"]).toBe("bus")
		expect(wayTags?.["ref"]).toBe("1")
		expect(wayTags?.["name"]).toBe("Downtown Express")
	})

	test("filters routes by type", async () => {
		const zipData = await createTestGtfsZip()
		const osm = await fromGtfs(
			zipData,
			{ id: "subway-only" },
			{ routeTypes: [1] }, // Only subway routes
		)

		// Our test data has bus routes (type 3), so no ways should be created
		expect(osm.ways.size).toBe(0)
	})

	test("filters stops by type", async () => {
		const zipData = await createTestGtfsZip()
		const osm = await fromGtfs(
			zipData,
			{ id: "stations-only" },
			{ stopTypes: [1] }, // Only stations (location_type=1)
		)

		// Count platform nodes (stops that match filter)
		let platformCount = 0
		for (let i = 0; i < osm.nodes.size; i++) {
			const tags = osm.nodes.tags.getTags(i)
			if (tags?.["public_transport"] === "station") {
				platformCount++
			}
		}
		expect(platformCount).toBe(1)
	})
})

describe("GtfsOsmBuilder", () => {
	test("can be used for step-by-step conversion", async () => {
		const zipData = await createTestGtfsZip()
		const archive = GtfsArchive.fromZip(zipData)

		const stops = await archive.stops()
		const routes = await archive.routes()

		expect(stops.length).toBe(3)
		expect(routes.length).toBe(1)

		const builder = new GtfsOsmBuilder({ id: "manual-test" })
		await builder.processArchive(archive)
		const osm = builder.buildOsm()

		expect(osm.nodes.size).toBeGreaterThanOrEqual(3)
		expect(osm.ways.size).toBe(1)
	})
})

describe("fromGtfs without shapes", () => {
	test("falls back to stop sequence when no shapes exist", async () => {
		const zipData = await createGtfsZipWithoutShapes()
		const osm = await fromGtfs(zipData, { id: "no-shapes" })

		// Should have 3 stops as nodes
		expect(osm.nodes.size).toBe(3)

		// Should have 1 route as way (using stop sequence as geometry)
		expect(osm.ways.size).toBe(1)

		// The way should reference the stop nodes
		const wayRefs = osm.ways.getRefIds(0)
		expect(wayRefs.length).toBe(3)
	})
})
