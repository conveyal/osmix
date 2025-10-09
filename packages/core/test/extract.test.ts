import { assert, describe, it } from "vitest"
import { writeOsmToPbfStream } from "../src/osm-to-pbf"
import { Osmix } from "../src/osmix"
import type { GeoBbox2D } from "../src/types"

const TEST_BBOX: GeoBbox2D = [-0.1, -0.1, 1, 1]

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

	osm.finish()
	return osm
}

async function writeOsmToBuffer(osm: Osmix) {
	const chunks: Uint8Array[] = []
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			chunks.push(chunk)
		},
	})
	await writeOsmToPbfStream(osm, writable)
	let byteLength = 0
	for (const chunk of chunks) {
		byteLength += chunk.byteLength
	}
	const combined = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		combined.set(chunk, offset)
		offset += chunk.byteLength
	}
	return combined.buffer
}

describe("Osmix.extractFromPBf", () => {
	it("extracts a simple subset from PBF input", async () => {
		const source = buildSourceOsm()
		const transform = new TransformStream<Uint8Array, ArrayBufferLike>()
		const extractPromise = Osmix.extractFromPbf(transform.readable, TEST_BBOX)
		await writeOsmToPbfStream(source, transform.writable)
		const simple = await extractPromise

		assert.equal(simple.nodes.size, 2)
		assert.isTrue(simple.nodes.ids.has(1))
		assert.isTrue(simple.nodes.ids.has(3))
		assert.isNotTrue(simple.nodes.ids.has(2))
		assert.isNotTrue(simple.nodes.ids.has(4))

		const truncatedWay = simple.ways.getById(10)
		assert.exists(truncatedWay)
		assert.deepEqual(truncatedWay?.refs, [1])

		assert.isTrue(simple.ways.ids.has(11))
		assert.isTrue(simple.relations.ids.has(20))
	})
})

describe("Streaming extract", () => {
	it("matches two-step simple extraction", async () => {
		const source = buildSourceOsm()
		const buffer = await writeOsmToBuffer(source)

		const streaming = await Osmix.extractFromPbf(
			buffer.slice(0),
			TEST_BBOX,
			"one-step",
		)
		const full = await Osmix.fromPbf(buffer.slice(0), "two-steps")
		const twoStep = full.extract(TEST_BBOX)

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
})
