import { describe, expect, test } from "bun:test"
import {
	fromGtfs,
	GtfsArchive,
	GtfsOsmBuilder,
	isGtfsZip,
	routeTypeToOsmRoute,
	wheelchairBoardingToOsm,
} from "../src"
import { routeToTags, stopToTags } from "../src/utils"
import { createSharedShapeGtfsZip, createTestGtfsZip } from "./helpers"

// Path to the Monaco GTFS fixture
const MONACO_GTFS_PATH = new URL(
	"../../../fixtures/monaco-gtfs.zip",
	import.meta.url,
)

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

describe("stopToTags", () => {
	test("tags regular stops as platforms", () => {
		const tags = stopToTags({
			stop_id: "stop1",
			stop_name: "Main St",
			stop_lat: "40.7128",
			stop_lon: "-74.0060",
			location_type: "0",
		})

		expect(tags["public_transport"]).toBe("platform")
		expect(tags["name"]).toBe("Main St")
	})

	test("tags stations correctly", () => {
		const tags = stopToTags({
			stop_id: "station1",
			stop_name: "Central Station",
			stop_lat: "40.7128",
			stop_lon: "-74.0060",
			location_type: "1",
		})

		expect(tags["public_transport"]).toBe("station")
	})

	test("tags entrances without public_transport tag", () => {
		const tags = stopToTags({
			stop_id: "entrance1",
			stop_name: "Station Entrance A",
			stop_lat: "40.7128",
			stop_lon: "-74.0060",
			location_type: "2",
		})

		// Entrances should have railway=subway_entrance but NOT public_transport
		expect(tags["railway"]).toBe("subway_entrance")
		expect(tags["public_transport"]).toBeUndefined()
		expect(tags["name"]).toBe("Station Entrance A")
	})

	test("tags boarding areas as platforms", () => {
		const tags = stopToTags({
			stop_id: "boarding1",
			stop_name: "Platform A",
			stop_lat: "40.7128",
			stop_lon: "-74.0060",
			location_type: "4",
		})

		expect(tags["public_transport"]).toBe("platform")
	})
})

describe("routeToTags", () => {
	test("normalizes valid hex colors", () => {
		const tags = routeToTags({
			route_id: "route1",
			route_short_name: "1",
			route_type: "3",
			route_color: "ff0000",
			route_text_color: "FFFFFF",
		})

		expect(tags["color"]).toBe("#FF0000")
		expect(tags["text_color"]).toBe("#FFFFFF")
	})

	test("accepts colors with # prefix", () => {
		const tags = routeToTags({
			route_id: "route1",
			route_short_name: "1",
			route_type: "3",
			route_color: "#00FF00",
		})

		expect(tags["color"]).toBe("#00FF00")
	})

	test("accepts 3-character shorthand colors", () => {
		const tags = routeToTags({
			route_id: "route1",
			route_short_name: "1",
			route_type: "3",
			route_color: "F00",
		})

		expect(tags["color"]).toBe("#FF0000")
	})

	test("rejects invalid hex colors", () => {
		const tags = routeToTags({
			route_id: "route1",
			route_short_name: "1",
			route_type: "3",
			route_color: "ZZZZZZ",
			route_text_color: "not-a-color",
		})

		// Invalid colors should not be added to tags
		expect(tags["color"]).toBeUndefined()
		expect(tags["text_color"]).toBeUndefined()
	})

	test("handles missing colors", () => {
		const tags = routeToTags({
			route_id: "route1",
			route_short_name: "1",
			route_type: "3",
		})

		expect(tags["color"]).toBeUndefined()
		expect(tags["text_color"]).toBeUndefined()
	})

	test("sets route type and name correctly", () => {
		const tags = routeToTags({
			route_id: "route1",
			route_short_name: "R1",
			route_long_name: "Red Line",
			route_type: "1",
		})

		expect(tags["route"]).toBe("subway")
		expect(tags["name"]).toBe("Red Line")
		expect(tags["ref"]).toBe("R1")
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
		const agencies = await Array.fromAsync(archive.iter("agency.txt"))
		expect(agencies.length).toBe(1)
		expect(agencies[0]?.agency_name).toBe("Test Transit")

		// Parse stops on demand
		const stops = await Array.fromAsync(archive.iter("stops.txt"))
		expect(stops.length).toBe(3)
		expect(stops[0]?.stop_name).toBe("Main St Station")

		// Parse routes on demand
		const routes = await Array.fromAsync(archive.iter("routes.txt"))
		expect(routes.length).toBe(1)
		expect(routes[0]?.route_short_name).toBe("1")
	})

	test("iterates stops without loading all at once", async () => {
		const zipData = await createTestGtfsZip()
		const archive = GtfsArchive.fromZip(zipData)

		const stops = []
		for await (const stop of archive.iter("stops.txt")) {
			stops.push(stop)
		}

		expect(stops.length).toBe(3)
		expect(stops[0]?.stop_name).toBe("Main St Station")
	})

	test("iter() returns correctly typed records", async () => {
		const zipData = await createTestGtfsZip()
		const archive = GtfsArchive.fromZip(zipData)

		// TypeScript should infer the correct type for each file
		for await (const stop of archive.iter("stops.txt")) {
			// stop is GtfsStop
			expect(stop.stop_id).toBeDefined()
			expect(stop.stop_lat).toBeDefined()
			break
		}

		for await (const route of archive.iter("routes.txt")) {
			// route is GtfsRoute
			expect(route.route_id).toBeDefined()
			expect(route.route_type).toBeDefined()
			break
		}

		for await (const shape of archive.iter("shapes.txt")) {
			// shape is GtfsShapePoint
			expect(shape.shape_id).toBeDefined()
			expect(shape.shape_pt_lat).toBeDefined()
			break
		}
	})
})

describe("isGtfsZip", () => {
	test("detects GTFS zip created in tests", async () => {
		const zipData = await createTestGtfsZip()
		expect(isGtfsZip(zipData)).toBe(true)
	})

	test("detects Monaco GTFS fixture as GTFS", async () => {
		const file = Bun.file(MONACO_GTFS_PATH)
		const zipData = new Uint8Array(await file.arrayBuffer())
		expect(isGtfsZip(zipData)).toBe(true)
	})

	test("returns false for non-GTFS zip", async () => {
		const encoder = new TextEncoder()
		const { zipSync } = await import("fflate")

		const bytes = zipSync({
			"readme.txt": encoder.encode("not a gtfs feed"),
			"data.csv": encoder.encode("col1,col2\n1,2\n"),
		})

		expect(isGtfsZip(bytes)).toBe(false)
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

	test("can exclude stops entirely", async () => {
		const zipData = await createTestGtfsZip()
		const osm = await fromGtfs(
			zipData,
			{ id: "routes-only" },
			{ includeStops: false },
		)

		// Should have only shape nodes, no stop nodes
		let stopCount = 0
		for (let i = 0; i < osm.nodes.size; i++) {
			const tags = osm.nodes.tags.getTags(i)
			if (tags?.["public_transport"]) {
				stopCount++
			}
		}
		expect(stopCount).toBe(0)

		// Should still have the route
		expect(osm.ways.size).toBe(1)
	})

	test("can exclude routes entirely", async () => {
		const zipData = await createTestGtfsZip()
		const osm = await fromGtfs(
			zipData,
			{ id: "stops-only" },
			{ includeRoutes: false },
		)

		// Should have stops
		let stopCount = 0
		for (let i = 0; i < osm.nodes.size; i++) {
			const tags = osm.nodes.tags.getTags(i)
			if (tags?.["public_transport"]) {
				stopCount++
			}
		}
		expect(stopCount).toBe(3)

		// Should have no routes
		expect(osm.ways.size).toBe(0)
	})

	test("creates separate ways for routes sharing the same shape", async () => {
		const zipData = await createSharedShapeGtfsZip()
		const osm = await fromGtfs(
			zipData,
			{ id: "shared-shape" },
			{ includeStops: false },
		)

		// Should have 2 ways - one for each route, even though they share a shape
		expect(osm.ways.size).toBe(2)

		// Collect way tags
		const wayTagsList: Record<string, unknown>[] = []
		for (let i = 0; i < osm.ways.size; i++) {
			const tags = osm.ways.tags.getTags(i)
			if (tags) wayTagsList.push(tags)
		}

		// Find the Red Line (route1) way
		const redLineWay = wayTagsList.find((tags) => tags["ref"] === "R1")
		expect(redLineWay).toBeDefined()
		expect(redLineWay?.["name"]).toBe("Red Line")
		expect(redLineWay?.["route"]).toBe("subway")
		expect(redLineWay?.["color"]).toBe("#FF0000")
		// Should have 2 trips (trip1 and trip2)
		expect(Number(redLineWay?.["gtfs:trip_count"])).toBe(2)
		expect(redLineWay?.["gtfs:trip_ids"]).toBe("trip1;trip2")

		// Find the Blue Express (route2) way
		const blueExpressWay = wayTagsList.find((tags) => tags["ref"] === "B2")
		expect(blueExpressWay).toBeDefined()
		expect(blueExpressWay?.["name"]).toBe("Blue Express")
		expect(blueExpressWay?.["route"]).toBe("bus")
		expect(blueExpressWay?.["color"]).toBe("#0000FF")
		// Should have 1 trip (trip3)
		expect(Number(blueExpressWay?.["gtfs:trip_count"])).toBe(1)
		expect(blueExpressWay?.["gtfs:trip_ids"]).toBe("trip3")

		// Both should reference the same shape
		expect(redLineWay?.["gtfs:shape_id"]).toBe("shared_shape")
		expect(blueExpressWay?.["gtfs:shape_id"]).toBe("shared_shape")
	})
})

describe("GtfsOsmBuilder", () => {
	test("can be used for step-by-step conversion", async () => {
		const zipData = await createTestGtfsZip()
		const archive = GtfsArchive.fromZip(zipData)

		const stops = await Array.fromAsync(archive.iter("stops.txt"))
		const routes = await Array.fromAsync(archive.iter("routes.txt"))

		expect(stops.length).toBe(3)
		expect(routes.length).toBe(1)

		const builder = new GtfsOsmBuilder({ id: "manual-test" })
		await builder.processStops(archive)
		await builder.processRoutes(archive)
		const osm = builder.buildOsm()

		expect(osm.nodes.size).toBeGreaterThanOrEqual(3)
		expect(osm.ways.size).toBe(1)
	})
})

describe("Monaco GTFS fixture", () => {
	test("parses Monaco GTFS archive", async () => {
		const file = Bun.file(MONACO_GTFS_PATH)
		const zipData = await file.arrayBuffer()
		const archive = GtfsArchive.fromZip(zipData)

		// Check expected files exist
		expect(archive.hasFile("agency.txt")).toBe(true)
		expect(archive.hasFile("stops.txt")).toBe(true)
		expect(archive.hasFile("routes.txt")).toBe(true)
		expect(archive.hasFile("shapes.txt")).toBe(true)
		expect(archive.hasFile("trips.txt")).toBe(true)
		expect(archive.hasFile("stop_times.txt")).toBe(true)

		// Parse agency
		const agencies = await Array.fromAsync(archive.iter("agency.txt"))
		expect(agencies.length).toBe(1)

		// Parse stops
		const stops = await Array.fromAsync(archive.iter("stops.txt"))
		expect(stops.length).toBe(98)

		// Parse routes
		const routes = await Array.fromAsync(archive.iter("routes.txt"))
		expect(routes.length).toBe(15)
	})

	test("converts Monaco GTFS to OSM with routes only", async () => {
		const zipData = await Bun.file(MONACO_GTFS_PATH).arrayBuffer()

		// Only include routes (no stops) to test shapes parsing
		const osm = await fromGtfs(
			zipData,
			{ id: "monaco-routes" },
			{ includeStops: false },
		)

		// Should have routes as ways (one per shape+route pair, not per trip)
		// Previously 271 when grouping by shape only, now 315 with shape+route pairs
		expect(osm.ways.size).toBe(315)

		// Check a route has proper tags
		const wayTags = osm.ways.tags.getTags(0)
		expect(wayTags?.["route"]).toBeDefined()
	})

	test("converts Monaco GTFS to OSM with stops only", async () => {
		const zipData = await Bun.file(MONACO_GTFS_PATH).arrayBuffer()

		// Only include stops (no routes)
		const osm = await fromGtfs(
			zipData,
			{ id: "monaco-stops" },
			{ includeRoutes: false },
		)

		// Should have stops as nodes
		expect(osm.nodes.size).toBeGreaterThan(0)

		// No routes
		expect(osm.ways.size).toBe(0)

		// Check a stop has proper tags
		let foundStop = false
		for (let i = 0; i < osm.nodes.size; i++) {
			const tags = osm.nodes.tags.getTags(i)
			if (tags?.["public_transport"]) {
				foundStop = true
				expect(tags["name"]).toBeDefined()
				break
			}
		}
		expect(foundStop).toBe(true)
	})

	test("converts full Monaco GTFS to OSM", async () => {
		const zipData = await Bun.file(MONACO_GTFS_PATH).arrayBuffer()

		const osm = await fromGtfs(zipData, { id: "monaco-full" })

		// Should have both stops and routes
		expect(osm.nodes.size).toBeGreaterThan(0)
		expect(osm.ways.size).toBeGreaterThan(0)

		console.log(`Monaco GTFS: ${osm.nodes.size} nodes, ${osm.ways.size} ways`)
	})
})
