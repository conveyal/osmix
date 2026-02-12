import { describe, expect, it } from "bun:test"
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "@osmix/pbf"
import type { OsmEntity } from "@osmix/shared/types"
import {
	createOsmJsonReadableStream,
	jsonEntitiesToBlocks,
	OsmJsonToBlocksTransformStream,
} from "../src/json-to-pbf"
import type { OsmPbfBlockBuilder } from "../src/osm-pbf-block-builder"

export function createSampleHeader(): OsmPbfHeaderBlock {
	return {
		bbox: { left: 0, right: 1, top: 1, bottom: 0 },
		required_features: ["OsmSchema-V0.6"],
		optional_features: ["DenseNodes"],
		writingprogram: "osmix-tests",
	}
}

async function* entityGenerator(entities: OsmEntity[]) {
	for (const entity of entities) {
		yield entity
	}
}

async function readStream<T>(stream: ReadableStream<T>) {
	const reader = stream.getReader()
	const results: T[] = []
	while (true) {
		const { value, done } = await reader.read()
		if (done) break
		results.push(value)
	}
	reader.releaseLock()
	return results
}

describe("json-to-pbf", () => {
	const nodes: OsmEntity[] = [
		{ id: 1, lat: 0, lon: 0 },
		{ id: 2, lat: 1, lon: 1 },
	]
	const way: OsmEntity = { id: 3, refs: [1, 2, 1] }
	const relation: OsmEntity = {
		id: 4,
		members: [
			{ type: "node", ref: 1 },
			{ type: "way", ref: 3, role: "inner" },
		],
	}

	it("yields grouped blocks", async () => {
		const blocks: OsmPbfBlock[] = []
		for await (const block of jsonEntitiesToBlocks(
			entityGenerator([...nodes, way, relation]),
		)) {
			blocks.push(block)
		}
		expect(blocks).toHaveLength(3)

		const nodeBlock = blocks[0]
		expect(nodeBlock?.primitivegroup[0]?.dense).toBeDefined()
		if (!nodeBlock) throw new Error("nodeBlock is undefined")
		if (!nodeBlock.primitivegroup[0])
			throw new Error("nodeBlock.primitivegroup[0] is undefined")
		expect(nodeBlock.primitivegroup[0].dense?.id).toHaveLength(2)
		expect(nodeBlock.primitivegroup[0].ways).toHaveLength(0)
		expect(nodeBlock.primitivegroup[0].relations).toHaveLength(0)

		const wayBlock = blocks[1]
		expect(wayBlock?.primitivegroup[0]).toBeDefined()
		if (!wayBlock) throw new Error("wayBlock is undefined")
		if (!wayBlock.primitivegroup[0])
			throw new Error("wayBlock.primitivegroup[0] is undefined")
		expect(wayBlock.primitivegroup[0].ways).toHaveLength(1)
		expect(wayBlock.primitivegroup[0].dense).toBeUndefined()

		const relBlock = blocks[2]
		expect(relBlock?.primitivegroup[0]).toBeDefined()
		if (!relBlock) throw new Error("relBlock is undefined")
		if (!relBlock.primitivegroup[0])
			throw new Error("relBlock.primitivegroup[0] is undefined")
		expect(relBlock.primitivegroup[0].relations).toHaveLength(1)
	})

	it("enqueues header before entities", async () => {
		const header = createSampleHeader()
		const stream = createOsmJsonReadableStream(
			header,
			entityGenerator([...nodes, way]),
		)
		const values = await readStream(stream)
		expect(values[0]).toBe(header)
		expect(values.slice(1)).toEqual([...nodes, way])
	})

	it("transforms readable stream into blocks", async () => {
		const header = createSampleHeader()
		const pipeline = createOsmJsonReadableStream(
			header,
			entityGenerator([...nodes, way, relation]),
		).pipeThrough(new OsmJsonToBlocksTransformStream())

		const outputs: unknown[] = []
		await pipeline.pipeTo(
			new WritableStream({
				write: (value) => {
					outputs.push(value)
				},
			}),
		)

		expect(outputs[0]).toBe(header)
		const blockOutputs = outputs.slice(1) as OsmPbfBlockBuilder[]
		expect(blockOutputs).toHaveLength(3)
		expect(blockOutputs[0]?.primitivegroup[0]).toBeDefined()
		expect(blockOutputs[1]?.primitivegroup[0]).toBeDefined()
		expect(blockOutputs[2]?.primitivegroup[0]).toBeDefined()
		if (!blockOutputs[0] || !blockOutputs[1] || !blockOutputs[2]) {
			throw new Error("blockOutputs are undefined")
		}
		if (
			!blockOutputs[0].primitivegroup[0] ||
			!blockOutputs[1].primitivegroup[0] ||
			!blockOutputs[2].primitivegroup[0]
		) {
			throw new Error("blockOutputs primitivegroup[0] are undefined")
		}
		expect(blockOutputs[0].primitivegroup[0].dense?.id).toHaveLength(2)
		expect(blockOutputs[1].primitivegroup[0].ways).toHaveLength(1)
		expect(blockOutputs[2].primitivegroup[0].relations).toHaveLength(1)
	})
})
