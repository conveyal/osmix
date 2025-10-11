import { getFixtureFileReadStream } from "@osmix/test-utils/fixtures"
import { assert, test } from "vitest"
import { Osmix } from "../src/osmix"
import type { GeoBbox2D } from "../src/types"

const TEST_BBOX: GeoBbox2D = [-0.1, -0.1, 1, 1]
const SEATTLE_BBOX: GeoBbox2D = [-122.463226, 47.469878, -122.180328, 47.82883]

function buildSourceOsm() {
	const osm = new Osmix("source")
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
	return osm
}

test("extract a BBOX while reading a PBF", async () => {
	const source = buildSourceOsm()
	const transform = new TransformStream<Uint8Array, ArrayBufferLike>()
	const extract = new Osmix("extract")
	const extractPromise = extract.readPbf(transform.readable, {
		extractBbox: TEST_BBOX,
	})
	await source.toPbfStream().pipeTo(transform.writable)
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
	const buffer = await source.toPbfBuffer()

	const streaming = new Osmix("streaming")
	await streaming.readPbf(buffer.slice(0), { extractBbox: TEST_BBOX })

	const twoStepOsmix = new Osmix("two-steps")
	await twoStepOsmix.readPbf(buffer.slice(0))
	const twoStep = twoStepOsmix.extract(TEST_BBOX)

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

test.skip("extract from a large PBF", { timeout: 500_000 }, async () => {
	const seattle = new Osmix()
	seattle.on((message, type) => {
		console.error(`[${type}] ${message}`)
	})
	await seattle.readPbf(getFixtureFileReadStream("usa.pbf"), {
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
