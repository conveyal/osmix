import { osmBlockToPbfBlobBytes } from "../src/blocks-to-pbf"
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "../src/proto/osmformat"
import { concatUint8 } from "../src/utils"

const encoder = new TextEncoder()

export function createSampleHeader(): OsmPbfHeaderBlock {
	return {
		bbox: { left: 0, right: 1, top: 1, bottom: 0 },
		required_features: ["OsmSchema-V0.6"],
		optional_features: ["DenseNodes"],
		writingprogram: "osmix-tests",
	}
}

export function createSamplePrimitiveBlock(): OsmPbfBlock {
	return {
		stringtable: [
			encoder.encode(""),
			encoder.encode("name"),
			encoder.encode("value"),
		],
		primitivegroup: [
			{
				nodes: [],
				dense: {
					id: [1, 2],
					lat: [1_000, 500],
					lon: [1_500, 600],
					keys_vals: [1, 2, 0],
				},
				ways: [
					{
						id: 10,
						keys: [1],
						vals: [2],
						refs: [1, 1, 0],
					},
				],
				relations: [],
			},
		],
	}
}

export async function createSamplePbfFileBytes() {
	const header = createSampleHeader()
	const primitiveBlock = createSamplePrimitiveBlock()
	const headerBytes = await osmBlockToPbfBlobBytes(header)
	const primitiveBytes = await osmBlockToPbfBlobBytes(primitiveBlock)
	return {
		header,
		primitiveBlock,
		fileBytes: concatUint8(headerBytes, primitiveBytes),
	}
}

export function isHeaderBlock(value: unknown): value is OsmPbfHeaderBlock {
	return (
		typeof value === "object" && value != null && "required_features" in value
	)
}

export function isPrimitiveBlock(value: unknown): value is OsmPbfBlock {
	return typeof value === "object" && value != null && "primitivegroup" in value
}
