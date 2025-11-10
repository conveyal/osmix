import type { OsmNode, OsmWay } from "@osmix/json"
import { describe, expect, it } from "vitest"
import { Nodes } from "../src/nodes"
import StringTable from "../src/stringtable"
import { Ways } from "../src/ways"

describe("Tags.search on Nodes", () => {
	it("finds by key and key+value", () => {
		const st = new StringTable()
		const nodes = new Nodes(st)
		const node1: OsmNode = { id: 1, lon: -1, lat: 1, tags: { curb: "yes" } }
		const node2: OsmNode = { id: 2, lon: -2, lat: 2, tags: { curb: "no" } }
		const node3: OsmNode = { id: 3, lon: -3, lat: 3 }
		nodes.addNode(node1)
		nodes.addNode(node2)
		nodes.addNode(node3)
		nodes.buildIndex()

		const allCurb = nodes.search("curb")
		expect(allCurb).toEqual([node1, node2])
		const curbYes = nodes.search("curb", "yes")
		expect(curbYes).toEqual([node1])
		const curbNo = nodes.search("curb", "no")
		expect(curbNo).toEqual([node2])
		const none = nodes.search("highway")
		expect(none).toEqual([])
	})
})

describe("Tags.search on Ways", () => {
	it("finds by key and key+value", () => {
		const st = new StringTable()
		const nodes = new Nodes(st)
		const ways = new Ways(st, nodes)
		const way1: OsmWay = {
			id: 10,
			refs: [1, 2],
			tags: { highway: "residential" },
		}
		const way2: OsmWay = { id: 11, refs: [2, 3], tags: { area: "yes" } }
		const way3: OsmWay = {
			id: 12,
			refs: [3, 4],
			tags: { highway: "primary", area: "no" },
		}
		ways.addWay(way1)
		ways.addWay(way2)
		ways.addWay(way3)
		ways.buildIndex()

		const allHighway = ways.search("highway")
		expect(allHighway).toEqual([way1, way3])
		const areaYes = ways.search("area", "yes")
		expect(areaYes).toEqual([way2])
		const areaAll = ways.search("area")
		expect(areaAll).toEqual([way2, way3])
		const areaNo = ways.search("area", "no")
		expect(areaNo).toEqual([way3])
	})
})
