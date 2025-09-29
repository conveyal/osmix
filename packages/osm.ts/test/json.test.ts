import { createOsmPbfReader, osmBlockToPbfBlobBytes } from "@osmix/pbf"
import { testReader } from "@osmix/pbf/test/utils"
import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures"
import { assert, describe, it } from "vitest"
import { OsmPbfBlockBuilder } from "../src/json/osm-pbf-block-builder"
import { OsmPbfBlockParser } from "../src/json/osm-pbf-block-parser"
import type { OsmEntity } from "../src/types"
import { isNode, isRelation, isWay } from "../src/utils"

describe("pbf json", () => {
	describe.each(Object.entries(PBFs))("%s", async (_name, pbf) => {
		it("parse all entities", async () => {
			const file = getFixtureFileReadStream(pbf.url)
			const osm = await createOsmPbfReader(file)

			let entities = 0
			for await (const block of osm.blocks) {
				const blockParser = new OsmPbfBlockParser(block)
				for await (const entity of blockParser) {
					entities += entity.length
				}
			}
			assert.equal(entities, pbf.nodes + pbf.ways + pbf.relations)
		})

		it("build from parsed entites", async () => {
			const file = getFixtureFileReadStream(pbf.url)
			const osm = await createOsmPbfReader(file)

			// Write the PBF to an array buffer
			let data = new Uint8Array(0)
			const write = (chunk: Uint8Array) => {
				const newData = new Uint8Array(data.length + chunk.length)
				newData.set(data)
				newData.set(chunk, data.length)
				data = newData
			}
			write(await osmBlockToPbfBlobBytes(osm.header))
			let blockBuilder = new OsmPbfBlockBuilder()

			// Directly take entities from the parsed PBF and add them to the new PBF
			const addEntity = async (entity: OsmEntity) => {
				if (blockBuilder.isFull()) {
					write(await osmBlockToPbfBlobBytes(blockBuilder))
					blockBuilder = new OsmPbfBlockBuilder()
				}
				if (isNode(entity)) {
					blockBuilder.addDenseNode(entity)
				} else if (isWay(entity)) {
					if (blockBuilder.primitivegroup[0].dense != null) {
						// Block builder has nodes, write it out and start a new block
						write(await osmBlockToPbfBlobBytes(blockBuilder))
						blockBuilder = new OsmPbfBlockBuilder()
					}
					blockBuilder.addWay(entity)
				} else if (isRelation(entity)) {
					if (blockBuilder.primitivegroup[0].ways.length > 0) {
						// Block builder has ways, write it out and start a new block
						write(await osmBlockToPbfBlobBytes(blockBuilder))
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
			write(await osmBlockToPbfBlobBytes(blockBuilder))

			// Re-parse the new PBF and test
			const osm2 = await createOsmPbfReader(data)
			await testReader(osm2, pbf)
		})
	})
})
