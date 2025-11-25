import { describe, expect, it } from "bun:test"
import { Osm } from "../src/osm"

describe("Osm", () => {
	it("creates empty index with default options", () => {
		const osm = new Osm()
		expect(osm.id).toBe("unknown")
		expect(osm.nodes.size).toBe(0)
		expect(osm.ways.size).toBe(0)
		expect(osm.relations.size).toBe(0)
	})

	it("creates index with custom id", () => {
		const osm = new Osm({ id: "test-extract" })
		expect(osm.id).toBe("test-extract")
	})

	it("adds nodes and builds indexes", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lon: -120.5, lat: 46.6 })
		osm.nodes.addNode({ id: 2, lon: -120.4, lat: 46.7 })
		osm.buildIndexes()

		expect(osm.nodes.size).toBe(2)
		expect(osm.isReady()).toBe(true)
	})

	it("adds ways referencing nodes", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lon: -120.5, lat: 46.6 })
		osm.nodes.addNode({ id: 2, lon: -120.4, lat: 46.7 })
		osm.nodes.buildIndex()
		osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "primary" } })
		osm.buildIndexes()

		expect(osm.ways.size).toBe(1)
		const way = osm.ways.getById(10)
		expect(way?.refs).toEqual([1, 2])
		expect(way?.tags?.["highway"]).toBe("primary")
	})

	it("computes bounding box from nodes", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lon: -120.5, lat: 46.6 })
		osm.nodes.addNode({ id: 2, lon: -120.4, lat: 46.7 })
		osm.buildIndexes()

		const bbox = osm.bbox()
		expect(bbox[0]).toBeCloseTo(-120.5, 5) // minLon
		expect(bbox[1]).toBeCloseTo(46.6, 5) // minLat
		expect(bbox[2]).toBeCloseTo(-120.4, 5) // maxLon
		expect(bbox[3]).toBeCloseTo(46.7, 5) // maxLat
	})

	it("provides info summary", () => {
		const osm = new Osm({ id: "test" })
		osm.nodes.addNode({ id: 1, lon: 0, lat: 0 })
		osm.nodes.buildIndex()
		osm.ways.addWay({ id: 10, refs: [1] })
		osm.buildIndexes()

		const info = osm.info()
		expect(info.id).toBe("test")
		expect(info.stats.nodes).toBe(1)
		expect(info.stats.ways).toBe(1)
		expect(info.stats.relations).toBe(0)
	})

	it("creates and uses transferables", () => {
		const osm = new Osm({ id: "source" })
		osm.nodes.addNode({ id: 1, lon: -120.5, lat: 46.6, tags: { name: "test" } })
		osm.nodes.buildIndex()
		osm.ways.addWay({ id: 10, refs: [1], tags: { highway: "primary" } })
		osm.buildIndexes()

		const transferables = osm.transferables()
		const osm2 = new Osm(transferables)

		expect(osm2.id).toBe("source")
		expect(osm2.nodes.size).toBe(1)
		expect(osm2.ways.size).toBe(1)
		expect(osm2.isReady()).toBe(true)

		const node = osm2.nodes.getById(1)
		expect(node?.tags?.["name"]).toBe("test")
	})
})
