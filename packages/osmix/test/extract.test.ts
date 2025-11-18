import { expect, test } from "bun:test"
import { Osm } from "@osmix/core"
import { getFixtureFileReadStream } from "@osmix/shared/test/fixtures"
import type { GeoBbox2D } from "@osmix/shared/types"
import { createExtract } from "../src/extract"
import { createOsmFromPbf, osmToPbfBuffer, osmToPbfStream } from "../src/pbf"

const TEST_BBOX: GeoBbox2D = [-0.1, -0.1, 1, 1]
const SEATTLE_BBOX: GeoBbox2D = [-122.463226, 47.469878, -122.180328, 47.82883]

function buildSourceOsm() {
	const osm = new Osm({ id: "source" })
	osm.nodes.addNode({
		id: 1,
		lat: 0,
		lon: 0,
		tags: {
			name: "inside-a",
		},
	})
	osm.nodes.addNode({
		id: 2,
		lat: 0,
		lon: 2,
		tags: {
			name: "outside-a",
		},
	})
	osm.nodes.addNode({
		id: 3,
		lat: 0.5,
		lon: 0.5,
	})
	osm.nodes.addNode({
		id: 4,
		lat: 0.5,
		lon: 1.5,
	})

	osm.ways.addWay({
		id: 10,
		refs: [1, 2],
		tags: {
			highway: "residential",
		},
	})
	osm.ways.addWay({
		id: 11,
		refs: [3, 4],
		tags: {
			highway: "service",
		},
	})

	osm.relations.addRelation({
		id: 20,
		members: [
			{
				type: "way",
				ref: 10,
				role: "outer",
			},
		],
		tags: {
			type: "multipolygon",
		},
	})

	osm.buildIndexes()
	osm.buildSpatialIndexes()
	return osm
}

test("extract a BBOX while reading a PBF", async () => {
	const source = buildSourceOsm()
	const transform = new TransformStream<
		Uint8Array<ArrayBufferLike>,
		Uint8Array<ArrayBufferLike>
	>()
	const extractPromise = createOsmFromPbf(transform.readable, {
		extractBbox: TEST_BBOX,
	})
	await osmToPbfStream(source).pipeTo(transform.writable)
	const extract = await extractPromise

	expect(extract.nodes.size).toBe(2)
	expect(extract.nodes.ids.has(1)).toBe(true)
	expect(extract.nodes.ids.has(3)).toBe(true)
	expect(extract.nodes.ids.has(2)).toBe(false)
	expect(extract.nodes.ids.has(4)).toBe(false)

	const truncatedWay = extract.ways.getById(10)
	expect(truncatedWay).toBeDefined()
	expect(truncatedWay?.refs).toEqual([1])

	expect(extract.ways.ids.has(11)).toBe(true)
	expect(extract.relations.ids.has(20)).toBe(true)
})

test("extract a BBOX after reading a PBF", async () => {
	const source = buildSourceOsm()
	const buffer = await osmToPbfBuffer(source)

	const streaming = await createOsmFromPbf(new Uint8Array(buffer.slice(0)), {
		extractBbox: TEST_BBOX,
	})

	const twoStepOsmix = await createOsmFromPbf(new Uint8Array(buffer.slice(0)))
	const twoStep = createExtract(twoStepOsmix, TEST_BBOX, "simple")

	expect(streaming.nodes.size).toBe(twoStep.nodes.size)
	expect(streaming.ways.size).toBe(twoStep.ways.size)
	expect(streaming.relations.size).toBe(twoStep.relations.size)

	expect(Array.from(streaming.nodes.ids.sorted)).toEqual(
		Array.from(twoStep.nodes.ids.sorted),
	)
	expect(Array.from(streaming.ways.ids.sorted)).toEqual(
		Array.from(twoStep.ways.ids.sorted),
	)
	expect(Array.from(streaming.relations.ids.sorted)).toEqual(
		Array.from(twoStep.relations.ids.sorted),
	)

	for (const nodeId of streaming.nodes.ids.sorted) {
		const streamingNode = streaming.nodes.getById(nodeId)
		const twoStepNode = twoStep.nodes.getById(nodeId)
		expect(streamingNode).toEqual(twoStepNode)
	}

	for (const wayId of streaming.ways.ids.sorted) {
		const streamingWay = streaming.ways.getById(wayId)
		const twoStepWay = twoStep.ways.getById(wayId)
		expect(streamingWay).toEqual(twoStepWay)
	}

	for (const relationId of streaming.relations.ids.sorted) {
		const streamingRelation = streaming.relations.getById(relationId)
		const twoStepRelation = twoStep.relations.getById(relationId)
		expect(streamingRelation).toEqual(twoStepRelation)
	}
})

test("extract with simple strategy filters way refs", () => {
	const source = buildSourceOsm()
	const extracted = createExtract(source, TEST_BBOX, "simple")

	// Should only have nodes inside bbox
	expect(extracted.nodes.size).toBe(2)
	expect(extracted.nodes.ids.has(1)).toBe(true) // inside
	expect(extracted.nodes.ids.has(3)).toBe(true) // inside
	expect(extracted.nodes.ids.has(2)).toBe(false) // outside
	expect(extracted.nodes.ids.has(4)).toBe(false) // outside

	// Way 10 has nodes [1, 2] - node 1 is inside, node 2 is outside
	// With simple strategy, should only include node 1
	const way10 = extracted.ways.getById(10)
	expect(way10).toBeDefined()
	expect(way10?.refs).toEqual([1])

	// Way 11 has nodes [3, 4] - node 3 is inside, node 4 is outside
	// With simple strategy, should only include node 3
	const way11 = extracted.ways.getById(11)
	expect(way11).toBeDefined()
	expect(way11?.refs).toEqual([3])

	// Relation 20 has way 10 as member
	// With simple strategy, relation should be included but way 10 is already filtered
	expect(extracted.relations.ids.has(20)).toBe(true)
	const relation20 = extracted.relations.getById(20)
	expect(relation20).toBeDefined()
	expect(relation20?.members.length).toBe(1)
	expect(relation20?.members[0]).toEqual({
		type: "way",
		ref: 10,
		role: "outer",
	})
})

test("extract with complete_ways strategy includes all way nodes", () => {
	const source = buildSourceOsm()
	const extracted = createExtract(source, TEST_BBOX, "complete_ways")

	// Should have nodes inside bbox PLUS all nodes from ways that cross bbox
	// Nodes 1 and 3 are inside bbox
	// Way 10 has nodes [1, 2] - node 2 should be included because way 10 crosses bbox
	// Way 11 has nodes [3, 4] - node 4 should be included because way 11 crosses bbox
	expect(extracted.nodes.size).toBe(4)
	expect(extracted.nodes.ids.has(1)).toBe(true) // inside
	expect(extracted.nodes.ids.has(2)).toBe(true) // outside but part of way 10
	expect(extracted.nodes.ids.has(3)).toBe(true) // inside
	expect(extracted.nodes.ids.has(4)).toBe(true) // outside but part of way 11

	// Way 10 should include all nodes
	const way10 = extracted.ways.getById(10)
	expect(way10).toBeDefined()
	expect(way10?.refs).toEqual([1, 2])

	// Way 11 should include all nodes
	const way11 = extracted.ways.getById(11)
	expect(way11).toBeDefined()
	expect(way11?.refs).toEqual([3, 4])

	// Relation 20 should include all members (way 10)
	expect(extracted.relations.ids.has(20)).toBe(true)
	const relation20 = extracted.relations.getById(20)
	expect(relation20).toBeDefined()
	expect(relation20?.members.length).toBe(1)
	expect(relation20?.members[0]).toEqual({
		type: "way",
		ref: 10,
		role: "outer",
	})
})

test("extract strategies differ for ways crossing bbox", () => {
	const source = buildSourceOsm()
	const simple = createExtract(source, TEST_BBOX, "simple")
	const complete = createExtract(source, TEST_BBOX, "complete_ways")

	// Simple strategy should have fewer nodes (only those inside bbox)
	expect(simple.nodes.size < complete.nodes.size).toBe(true)
	expect(simple.nodes.size).toBe(2)
	expect(complete.nodes.size).toBe(4)

	// Both should have the same ways
	expect(simple.ways.size).toBe(complete.ways.size)
	expect(simple.ways.size).toBe(2)

	// But way refs should differ
	const simpleWay10 = simple.ways.getById(10)
	const completeWay10 = complete.ways.getById(10)
	expect(simpleWay10).toBeDefined()
	expect(completeWay10).toBeDefined()
	expect(simpleWay10!.refs.length < completeWay10!.refs.length).toBe(true)
	expect(simpleWay10!.refs).toEqual([1])
	expect(completeWay10!.refs).toEqual([1, 2])
})

test("extract with complete_ways includes relation members outside bbox", () => {
	const osm = new Osm({ id: "test" })
	// Create nodes: some inside, some outside bbox
	osm.nodes.addNode({ id: 1, lat: 0, lon: 0 }) // inside
	osm.nodes.addNode({ id: 2, lat: 0, lon: 2 }) // outside
	osm.nodes.addNode({ id: 3, lat: 0.5, lon: 0.5 }) // inside
	osm.nodes.addNode({ id: 4, lat: 0.5, lon: 1.5 }) // outside

	// Create way 10 with nodes inside and outside
	osm.ways.addWay({ id: 10, refs: [1, 2] })
	// Create way 20 completely outside bbox
	osm.ways.addWay({ id: 20, refs: [2, 4] })

	// Create relation with way 10 (crosses bbox) and way 20 (outside bbox)
	osm.relations.addRelation({
		id: 30,
		members: [
			{ type: "way", ref: 10, role: "outer" },
			{ type: "way", ref: 20, role: "inner" },
		],
		tags: { type: "multipolygon" },
	})

	osm.buildIndexes()
	osm.buildSpatialIndexes()

	const simple = createExtract(osm, TEST_BBOX, "simple")
	const complete = createExtract(osm, TEST_BBOX, "complete_ways")

	// Simple strategy: relation should only include way 10 (way 20 is outside)
	const simpleRelation = simple.relations.getById(30)
	expect(simpleRelation).toBeDefined()
	expect(simpleRelation!.members.length).toBe(1)
	const simpleMember = simpleRelation!.members[0]
	expect(simpleMember).toBeDefined()
	expect(simpleMember!.ref).toBe(10)

	// Complete strategy: relation should include both ways
	const completeRelation = complete.relations.getById(30)
	expect(completeRelation).toBeDefined()
	expect(completeRelation!.members.length).toBe(2)
	expect(completeRelation!.members.some((m) => m.ref === 10)).toBe(true)
	expect(completeRelation!.members.some((m) => m.ref === 20)).toBe(true)

	// Complete strategy should also include way 20 and its nodes
	expect(complete.ways.ids.has(20)).toBe(true)
	expect(complete.nodes.ids.has(2)).toBe(true)
	expect(complete.nodes.ids.has(4)).toBe(true)
})

test("extract with complete_ways includes node members of relations", () => {
	const osm = new Osm({ id: "test" })
	osm.nodes.addNode({ id: 1, lat: 0, lon: 0 }) // inside
	osm.nodes.addNode({ id: 2, lat: 0, lon: 2 }) // outside
	osm.nodes.addNode({ id: 3, lat: 0.5, lon: 0.5 }) // inside

	osm.ways.addWay({ id: 10, refs: [1, 3] })

	// Create relation with node members (some inside, some outside)
	osm.relations.addRelation({
		id: 20,
		members: [
			{ type: "node", ref: 1, role: "label" },
			{ type: "node", ref: 2, role: "label" },
			{ type: "way", ref: 10, role: "outer" },
		],
		tags: { type: "multipolygon" },
	})

	osm.buildIndexes()
	osm.buildSpatialIndexes()

	const simple = createExtract(osm, TEST_BBOX, "simple")
	const complete = createExtract(osm, TEST_BBOX, "complete_ways")

	// Simple strategy: relation should only include node 1 and way 10
	const simpleRelation = simple.relations.getById(20)
	expect(simpleRelation).toBeDefined()
	expect(simpleRelation!.members.length).toBe(2)
	expect(
		simpleRelation!.members.some((m) => m.type === "node" && m.ref === 1),
	).toBe(true)
	expect(
		simpleRelation!.members.some((m) => m.type === "way" && m.ref === 10),
	).toBe(true)

	// Complete strategy: relation should include all members (node 1, node 2, way 10)
	const completeRelation = complete.relations.getById(20)
	expect(completeRelation).toBeDefined()
	expect(completeRelation!.members.length).toBe(3)
	expect(
		completeRelation!.members.some((m) => m.type === "node" && m.ref === 1),
	).toBe(true)
	expect(
		completeRelation!.members.some((m) => m.type === "node" && m.ref === 2),
	).toBe(true)
	expect(
		completeRelation!.members.some((m) => m.type === "way" && m.ref === 10),
	).toBe(true)

	// Complete strategy should also include node 2
	expect(complete.nodes.ids.has(2)).toBe(true)
	expect(simple.nodes.ids.has(2)).toBe(false)
})

test.skip("extract from a large PBF", async () => {
	const seattle = await createOsmFromPbf(getFixtureFileReadStream("usa.pbf"), {
		extractBbox: SEATTLE_BBOX,
	})

	expect({
		nodes: seattle.nodes.size,
		ways: seattle.ways.size,
		relations: seattle.relations.size,
	}).toEqual({ nodes: 802_541, ways: 241_248, relations: 3_622 })
})
