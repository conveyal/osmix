import { VectorTile } from "@mapbox/vector-tile"
import Protobuf from "pbf"
import { describe, expect, it } from "vitest"
import {
	type BinaryTilePayload,
	createBinaryVtIndex,
	encodeBinaryTile,
	type TileIndex,
} from "../src/index"

const DATASET = "test-osm"
const TILE_INDEX: TileIndex = { z: 14, x: 4823, y: 6160 }

const samplePayload: BinaryTilePayload = {
	nodes: {
		ids: new Float64Array([123]),
		positions: new Float64Array([-74.0002, 40.7128]),
	},
	ways: {
		ids: new Float64Array([456]),
		positions: new Float64Array([
			-74.01, 40.72, -74.005, 40.715, -74.001, 40.7122,
		]),
		startIndices: new Uint32Array([0, 3]),
	},
}

const decodeTile = (data: Uint8Array) => {
	const tile = new VectorTile(new Protobuf(Buffer.from(data)))
	return tile.layers["osmix"]
}

describe("encodeBinaryTile", () => {
	it("encodes nodes and ways with expected metadata", () => {
		const result = encodeBinaryTile(samplePayload, {
			datasetId: DATASET,
			tileIndex: TILE_INDEX,
			includeTileKey: true,
		})

		expect(result.stats.nodes).toBe(1)
		expect(result.stats.ways).toBe(1)
		expect(result.data.byteLength).toBeGreaterThan(0)

		const layer = decodeTile(result.data)
		expect(layer).toBeDefined()
		expect(layer.length).toBe(2)

		const features = Array.from({ length: layer.length }, (_, i) =>
			layer.feature(i),
		)

		const node = features.find(
			(feature) => feature.properties.entityType === "node",
		)
		expect(node?.id).toBe(123)
		expect(node?.type).toBe(1)
		expect(node?.properties.featureId).toBe("n123")
		expect(node?.properties.tileKey).toBe(
			`${DATASET}:${TILE_INDEX.z}:${TILE_INDEX.x}:${TILE_INDEX.y}`,
		)
		const nodeGeom = node?.loadGeometry()
		expect(nodeGeom?.[0]?.[0]?.x).toBeTypeOf("number")
		expect(nodeGeom?.[0]?.[0]?.y).toBeTypeOf("number")

		const way = features.find(
			(feature) => feature.properties.entityType === "way",
		)
		expect(way?.id).toBe(456)
		expect(way?.type).toBe(2)
		expect(way?.properties.featureId).toBe("w456")
		const wayGeom = way?.loadGeometry()
		expect(wayGeom?.[0]?.length).toBeGreaterThanOrEqual(2)
	})
})

describe("createBinaryVtIndex", () => {
	it("loads tiles via loader and caches results", async () => {
		let callCount = 0
		const index = createBinaryVtIndex(
			async () => {
				callCount++
				return samplePayload
			},
			{
				datasetId: DATASET,
				includeTileKey: true,
				maxCacheEntries: 2,
			},
		)

		const first = await index.getTile(TILE_INDEX.z, TILE_INDEX.x, TILE_INDEX.y)
		expect(first).toBeInstanceOf(Uint8Array)
		expect(callCount).toBe(1)

		const metadata = await index.getDebugMetadata(
			TILE_INDEX.z,
			TILE_INDEX.x,
			TILE_INDEX.y,
		)
		expect(metadata?.stats.nodes).toBe(1)
		expect(callCount).toBe(1)

		index.invalidate(TILE_INDEX.z, TILE_INDEX.x, TILE_INDEX.y)
		await index.getTile(TILE_INDEX.z, TILE_INDEX.x, TILE_INDEX.y)
		expect(callCount).toBe(2)

		index.clearCache()
		await index.getTile(TILE_INDEX.z, TILE_INDEX.x, TILE_INDEX.y)
		expect(callCount).toBe(3)
	})
})
