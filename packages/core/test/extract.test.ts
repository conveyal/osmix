import { getFixtureFileReadStream } from "@osmix/shared/test/fixtures"
import type { GeoBbox2D } from "@osmix/shared/types"
import { assert, test } from "vitest"
import { createExtract, Osmix } from "../src"
import { osmixFromPbf, osmixToPbfBuffer, osmixToPbfStream } from "../src/pbf"

const TEST_BBOX: GeoBbox2D = [-0.1, -0.1, 1, 1]
const SEATTLE_BBOX: GeoBbox2D = [-122.463226, 47.469878, -122.180328, 47.82883]

function buildSourceOsm() {
	const osm = new Osmix({ id: "source" })
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
	const extract = new Osmix()
	const extractPromise = osmixFromPbf(extract, transform.readable, {
		extractBbox: TEST_BBOX,
	})
	await osmixToPbfStream(source).pipeTo(transform.writable)
	await extractPromise

	assert.equal(extract.nodes.size, 2)
	assert.isTrue(extract.nodes.ids.has(1))
	assert.isTrue(extract.nodes.ids.has(3))
	assert.isNotTrue(extract.nodes.ids.has(2))
	assert.isNotTrue(extract.nodes.ids.has(4))

	const truncatedWay = extract.ways.getById(10)
	assert.exists(truncatedWay)
	assert.deepEqual(truncatedWay?.refs, [1])

	assert.isTrue(extract.ways.ids.has(11))
	assert.isTrue(extract.relations.ids.has(20))
})

test("extract a BBOX after reading a PBF", async () => {
	const source = buildSourceOsm()
	const buffer = await osmixToPbfBuffer(source)

	const streaming = new Osmix()
	await osmixFromPbf(streaming, new Uint8Array(buffer.slice(0)), {
		extractBbox: TEST_BBOX,
	})

	const twoStepOsmix = new Osmix()
	await osmixFromPbf(twoStepOsmix, new Uint8Array(buffer.slice(0)))
	const twoStep = createExtract(twoStepOsmix, TEST_BBOX, "simple")

	assert.equal(streaming.nodes.size, twoStep.nodes.size)
	assert.equal(streaming.ways.size, twoStep.ways.size)
	assert.equal(streaming.relations.size, twoStep.relations.size)

	assert.deepEqual(
		Array.from(streaming.nodes.ids.sorted),
		Array.from(twoStep.nodes.ids.sorted),
	)
	assert.deepEqual(
		Array.from(streaming.ways.ids.sorted),
		Array.from(twoStep.ways.ids.sorted),
	)
	assert.deepEqual(
		Array.from(streaming.relations.ids.sorted),
		Array.from(twoStep.relations.ids.sorted),
	)

	for (const nodeId of streaming.nodes.ids.sorted) {
		const streamingNode = streaming.nodes.getById(nodeId)
		const twoStepNode = twoStep.nodes.getById(nodeId)
		assert.deepEqual(streamingNode, twoStepNode)
	}

	for (const wayId of streaming.ways.ids.sorted) {
		const streamingWay = streaming.ways.getById(wayId)
		const twoStepWay = twoStep.ways.getById(wayId)
		assert.deepEqual(streamingWay, twoStepWay)
	}

	for (const relationId of streaming.relations.ids.sorted) {
		const streamingRelation = streaming.relations.getById(relationId)
		const twoStepRelation = twoStep.relations.getById(relationId)
		assert.deepEqual(streamingRelation, twoStepRelation)
	}
})

test("extract with simple strategy filters way refs", () => {
	const source = buildSourceOsm()
	const extracted = createExtract(source, TEST_BBOX, "simple")

	// Should only have nodes inside bbox
	assert.equal(extracted.nodes.size, 2)
	assert.isTrue(extracted.nodes.ids.has(1)) // inside
	assert.isTrue(extracted.nodes.ids.has(3)) // inside
	assert.isNotTrue(extracted.nodes.ids.has(2)) // outside
	assert.isNotTrue(extracted.nodes.ids.has(4)) // outside

	// Way 10 has nodes [1, 2] - node 1 is inside, node 2 is outside
	// With simple strategy, should only include node 1
	const way10 = extracted.ways.getById(10)
	assert.exists(way10)
	assert.deepEqual(way10?.refs, [1])

	// Way 11 has nodes [3, 4] - node 3 is inside, node 4 is outside
	// With simple strategy, should only include node 3
	const way11 = extracted.ways.getById(11)
	assert.exists(way11)
	assert.deepEqual(way11?.refs, [3])

	// Relation 20 has way 10 as member
	// With simple strategy, relation should be included but way 10 is already filtered
	assert.isTrue(extracted.relations.ids.has(20))
	const relation20 = extracted.relations.getById(20)
	assert.exists(relation20)
	assert.equal(relation20?.members.length, 1)
	assert.deepEqual(relation20?.members[0], {
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
	assert.equal(extracted.nodes.size, 4)
	assert.isTrue(extracted.nodes.ids.has(1)) // inside
	assert.isTrue(extracted.nodes.ids.has(2)) // outside but part of way 10
	assert.isTrue(extracted.nodes.ids.has(3)) // inside
	assert.isTrue(extracted.nodes.ids.has(4)) // outside but part of way 11

	// Way 10 should include all nodes
	const way10 = extracted.ways.getById(10)
	assert.exists(way10)
	assert.deepEqual(way10?.refs, [1, 2])

	// Way 11 should include all nodes
	const way11 = extracted.ways.getById(11)
	assert.exists(way11)
	assert.deepEqual(way11?.refs, [3, 4])

	// Relation 20 should include all members (way 10)
	assert.isTrue(extracted.relations.ids.has(20))
	const relation20 = extracted.relations.getById(20)
	assert.exists(relation20)
	assert.equal(relation20?.members.length, 1)
	assert.deepEqual(relation20?.members[0], {
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
	assert.isTrue(simple.nodes.size < complete.nodes.size)
	assert.equal(simple.nodes.size, 2)
	assert.equal(complete.nodes.size, 4)

	// Both should have the same ways
	assert.equal(simple.ways.size, complete.ways.size)
	assert.equal(simple.ways.size, 2)

	// But way refs should differ
	const simpleWay10 = simple.ways.getById(10)
	const completeWay10 = complete.ways.getById(10)
	assert.exists(simpleWay10)
	assert.exists(completeWay10)
	assert.isTrue(simpleWay10!.refs.length < completeWay10!.refs.length)
	assert.deepEqual(simpleWay10!.refs, [1])
	assert.deepEqual(completeWay10!.refs, [1, 2])
})

test("extract with complete_ways includes relation members outside bbox", () => {
	const osm = new Osmix({ id: "test" })
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
	assert.exists(simpleRelation)
	assert.equal(simpleRelation!.members.length, 1)
	const simpleMember = simpleRelation!.members[0]
	assert.exists(simpleMember)
	assert.equal(simpleMember.ref, 10)

	// Complete strategy: relation should include both ways
	const completeRelation = complete.relations.getById(30)
	assert.exists(completeRelation)
	assert.equal(completeRelation!.members.length, 2)
	assert.isTrue(completeRelation!.members.some((m) => m.ref === 10))
	assert.isTrue(completeRelation!.members.some((m) => m.ref === 20))

	// Complete strategy should also include way 20 and its nodes
	assert.isTrue(complete.ways.ids.has(20))
	assert.isTrue(complete.nodes.ids.has(2))
	assert.isTrue(complete.nodes.ids.has(4))
})

test("extract with complete_ways includes node members of relations", () => {
	const osm = new Osmix({ id: "test" })
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
	assert.exists(simpleRelation)
	assert.equal(simpleRelation!.members.length, 2)
	assert.isTrue(
		simpleRelation!.members.some((m) => m.type === "node" && m.ref === 1),
	)
	assert.isTrue(
		simpleRelation!.members.some((m) => m.type === "way" && m.ref === 10),
	)

	// Complete strategy: relation should include all members (node 1, node 2, way 10)
	const completeRelation = complete.relations.getById(20)
	assert.exists(completeRelation)
	assert.equal(completeRelation!.members.length, 3)
	assert.isTrue(
		completeRelation!.members.some((m) => m.type === "node" && m.ref === 1),
	)
	assert.isTrue(
		completeRelation!.members.some((m) => m.type === "node" && m.ref === 2),
	)
	assert.isTrue(
		completeRelation!.members.some((m) => m.type === "way" && m.ref === 10),
	)

	// Complete strategy should also include node 2
	assert.isTrue(complete.nodes.ids.has(2))
	assert.isNotTrue(simple.nodes.ids.has(2))
})

test.skip("extract from a large PBF", { timeout: 500_000 }, async () => {
	const seattle = new Osmix()
	await osmixFromPbf(seattle, getFixtureFileReadStream("usa.pbf"), {
		extractBbox: SEATTLE_BBOX,
	})

	assert.deepEqual(
		{
			nodes: seattle.nodes.size,
			ways: seattle.ways.size,
			relations: seattle.relations.size,
		},
		{ nodes: 802_541, ways: 241_248, relations: 3_622 },
	)
})
