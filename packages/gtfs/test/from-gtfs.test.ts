import { describe, expect, test } from "bun:test"
import {
	fromGtfs,
	GtfsOsmBuilder,
	parseGtfsZip,
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

describe("parseGtfsZip", () => {
	test("parses a GTFS zip file", async () => {
		const zipData = await createTestGtfsZip()
		const feed = await parseGtfsZip(zipData)

		expect(feed.agencies.length).toBe(1)
		expect(feed.agencies[0]?.agency_name).toBe("Test Transit")

		expect(feed.stops.length).toBe(3)
		expect(feed.stops[0]?.stop_name).toBe("Main St Station")

		expect(feed.routes.length).toBe(1)
		expect(feed.routes[0]?.route_short_name).toBe("1")

		expect(feed.trips.length).toBe(1)
		expect(feed.shapes.length).toBe(3)
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

		const builder = new GtfsOsmBuilder({ id: "manual-test" })
		const feed = await builder.parseGtfsZip(zipData)

		expect(feed.stops.length).toBe(3)
		expect(feed.routes.length).toBe(1)

		builder.processGtfsFeed(feed)
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
