import { assert, describe, it } from "vitest"

import { OsmPbfBlockBuilder } from "../src/osm-pbf-block-builder"
import { OsmPbfBlockParser } from "../src/osm-pbf-block-parser"
import { OsmPbfReader } from "../src/pbf/osm-pbf-reader"
import { OsmPbfWriter } from "../src/pbf/osm-pbf-writer"
import type { OsmEntity } from "../src/types"
import { isNode, isRelation, isWay } from "../src/utils"
import { PBFs, type PbfFixture } from "./files"
import { WriteableStreamArrayBuffer, getFile, getFileReadStream } from "./utils"

async function testReader(osm: OsmPbfReader, pbf: PbfFixture) {
	assert.deepEqual(osm.header.bbox, pbf.bbox)

	let node0: number | null = null
	let way0: number | null = null
	let relation0: number | null = null

	let nodes = 0
	let ways = 0
	let relations = 0
	for await (const block of osm.blocks) {
		for (const group of block.primitivegroup) {
			if (node0 == null && group.dense != null) {
				node0 = group.dense.id[0]
			}
			if (way0 == null && group.ways.length > 0) {
				way0 = group.ways[0].id
			}
			if (relation0 == null && group.relations.length > 0) {
				relation0 = group.relations[0].id
			}

			nodes += group.nodes?.length ?? 0
			if (group.dense) {
				nodes += group.dense.id.length
			}
			ways += group.ways?.length ?? 0
			relations += group.relations?.length ?? 0
		}
	}

	assert.equal(nodes, pbf.nodes)
	assert.equal(ways, pbf.ways)
	assert.equal(relations, pbf.relations)

	return { node0, way0, relation0 }
}

describe("pbf", () => {
	describe.each(Object.entries(PBFs))("%s", async (name, pbf) => {
		describe("read", () => {
			it.runIf(pbf.nodes < 40_000)("from stream", async () => {
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await OsmPbfReader.from(fileStream)
				await testReader(osm, pbf)
			})

			it.runIf(pbf.nodes <= 40_000)("from buffer", async () => {
				const fileData = await getFile(pbf.url)
				const osm = await OsmPbfReader.from(fileData)
				await testReader(osm, pbf)
			})
		})

		describe("write", () => {
			it.runIf(pbf.nodes < 40_000)("to buffer", async () => {
				const fileData = await getFile(pbf.url)
				const osm = await OsmPbfReader.from(fileData)

				let node0: number | null = null
				let way0: number | null = null
				let relation0: number | null = null

				// Write the PBF to an array buffer
				const stream = new WriteableStreamArrayBuffer()
				const writer = new OsmPbfWriter(stream)
				await writer.writeHeader(osm.header)
				for await (const block of osm.blocks) {
					for (const group of block.primitivegroup) {
						if (node0 == null && group.dense != null) {
							node0 = group.dense.id[0]
						}
						if (way0 == null && group.ways.length > 0) {
							way0 = group.ways[0].id
						}
						if (relation0 == null && group.relations.length > 0) {
							relation0 = group.relations[0].id
						}
					}
					await writer.writePrimitiveBlock(block)
				}
				await writer.close()

				// Re-parse the new PBF and test
				assert.exists(stream.buffer)
				// TODO: assert.equal(stream.buffer.byteLength, fileData.byteLength)
				const osm2 = await OsmPbfReader.from(stream.buffer)

				assert.deepEqual(osm.header, osm2.header)
				const entities = await testReader(osm2, pbf)
				assert.equal(entities.node0, node0)
				assert.equal(entities.way0, way0)
				assert.equal(entities.relation0, relation0)
			})
		})

		describe("parser", () => {
			it.runIf(pbf.nodes < 40_000)("parse all entities", async () => {
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await OsmPbfReader.from(fileStream)

				let entities = 0
				for await (const block of osm.blocks) {
					const blockParser = new OsmPbfBlockParser(block)
					for await (const entity of blockParser) {
						entities += entity.length
					}
				}
				assert.equal(entities, pbf.nodes + pbf.ways + pbf.relations)
			})

			it.runIf(pbf.nodes < 40_000)("build from parsed entites", async () => {
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await OsmPbfReader.from(fileStream)

				// Write the PBF to an array buffer
				const stream = new WriteableStreamArrayBuffer()
				const writer = new OsmPbfWriter(stream)
				await writer.writeHeader(osm.header)
				let blockBuilder = new OsmPbfBlockBuilder()

				// Directly take entities from the parsed PBF and add them to the new PBF
				const addEntity = async (entity: OsmEntity) => {
					if (blockBuilder.isFull()) {
						await writer.writePrimitiveBlock(blockBuilder)
						blockBuilder = new OsmPbfBlockBuilder()
					}
					if (isNode(entity)) {
						blockBuilder.addDenseNode(entity)
					} else if (isWay(entity)) {
						if (blockBuilder.primitivegroup[0].dense != null) {
							// Block builder has nodes, write it out and start a new block
							await writer.writePrimitiveBlock(blockBuilder)
							blockBuilder = new OsmPbfBlockBuilder()
						}
						blockBuilder.addWay(entity)
					} else if (isRelation(entity)) {
						if (blockBuilder.primitivegroup[0].ways.length > 0) {
							// Block builder has ways, write it out and start a new block
							await writer.writePrimitiveBlock(blockBuilder)
							blockBuilder = new OsmPbfBlockBuilder()
						}
						blockBuilder.addRelation(entity)
					}
				}

				for await (const block of osm.blocks) {
					const blockParser = new OsmPbfBlockParser(block)
					for (const entities of blockParser) {
						for (const e of entities) {
							await addEntity(e)
						}
					}
				}
				await writer.writePrimitiveBlock(blockBuilder)
				await writer.close()

				// Re-parse the new PBF and test
				const osm2 = await OsmPbfReader.from(stream.data.compact().buffer)
				await testReader(osm2, pbf)
			})
		})
	})
})
