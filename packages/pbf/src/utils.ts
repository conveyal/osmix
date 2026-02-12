import { assertValue as assert } from "@osmix/shared/assert"
import type { PbfFixture } from "@osmix/shared/fixtures"
import { transformBytes } from "@osmix/shared/transform-bytes"
import type {
	OsmPbfBlock,
	OsmPbfGroup,
	OsmPbfHeaderBlock,
} from "../src/proto/osmformat"

export type AsyncGeneratorValue<T> =
	| T
	| ReadableStream<T>
	| AsyncGenerator<T>
	| Promise<T>
	| Promise<ReadableStream<T>>
	| Promise<AsyncGenerator<T>>

/**
 * Normalizes values, streams, and iterables into a unified async generator interface.
 */
export async function* toAsyncGenerator<T>(
	v: AsyncGeneratorValue<T>,
): AsyncGenerator<T> {
	if (v instanceof Promise) return toAsyncGenerator(await v)

	if (v == null) throw Error("Value is null")
	if (v instanceof ReadableStream) {
		const reader = v.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			yield value
		}
		reader.releaseLock()
	} else if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
		// Treat ArrayBuffer and TypedArrays (like Uint8Array, Buffer) as single values
		yield v as T
	} else if (
		typeof v === "object" &&
		(Symbol.asyncIterator in v || Symbol.iterator in v)
	) {
		return v
	} else {
		yield v
	}
}

/**
 * Web decompression stream
 */
export async function webDecompress(
	data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return transformBytes(data, new DecompressionStream("deflate"))
}

/**
 * Web compression stream
 */
export async function webCompress(
	data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return transformBytes(data, new CompressionStream("deflate"))
}

/**
 * Concatenates multiple `Uint8Array` segments into a contiguous array.
 */
export function concatUint8(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array(total)
	let offset = 0
	for (const p of parts) {
		out.set(p, offset)
		offset += p.length
	}
	return out
}

/**
 * Encodes a 32-bit big-endian unsigned integer as a four-byte buffer.
 */
export function uint32BE(n: number): Uint8Array {
	const out = new Uint8Array(4)
	out[0] = (n >>> 24) & 0xff
	out[1] = (n >>> 16) & 0xff
	out[2] = (n >>> 8) & 0xff
	out[3] = n & 0xff
	return out
}

export async function testOsmPbfReader(
	osm: {
		header: OsmPbfHeaderBlock
		blocks: AsyncGenerator<OsmPbfBlock>
	},
	pbf: PbfFixture,
) {
	assert(
		JSON.stringify(osm.header.bbox) === JSON.stringify(pbf.bbox),
		`Header bbox ${JSON.stringify(osm.header.bbox)} != ${JSON.stringify(pbf.bbox)}`,
	)

	const { onGroup, count } = createOsmEntityCounter()
	for await (const block of osm.blocks)
		for (const group of block.primitivegroup) onGroup(group)

	assert(
		count.nodes === pbf.nodes,
		`Expected nodes: ${pbf.nodes}, got: ${count.nodes}`,
	)
	assert(
		count.ways === pbf.ways,
		`Expected ways: ${pbf.ways}, got: ${count.ways}`,
	)
	assert(
		count.relations === pbf.relations,
		`Expected relations: ${pbf.relations}, got: ${count.relations}`,
	)
	assert(
		count.node0 === pbf.node0.id,
		`Expected node0: ${pbf.node0.id}, got: ${count.node0}`,
	)
	assert(
		count.way0 === pbf.way0,
		`Expected way0: ${pbf.way0}, got: ${count.way0}`,
	)
	assert(
		count.relation0 === pbf.relation0,
		`Expected relation0: ${pbf.relation0}, got: ${count.relation0}`,
	)

	return count
}

export function createOsmEntityCounter() {
	const count = {
		nodes: 0,
		ways: 0,
		relations: 0,
		node0: -1,
		way0: -1,
		relation0: -1,
	}

	const onGroup = (group: OsmPbfGroup) => {
		if (count.node0 === -1 && group.dense?.id?.[0] != null) {
			count.node0 = group.dense.id[0]
		}
		if (count.way0 === -1 && group.ways?.[0]?.id != null) {
			count.way0 = group.ways[0].id
		}
		if (count.relation0 === -1 && group.relations?.[0]?.id != null) {
			count.relation0 = group.relations[0].id
		}

		count.nodes += group.nodes?.length ?? 0
		if (group.dense) {
			count.nodes += group.dense.id.length
		}
		count.ways += group.ways?.length ?? 0
		count.relations += group.relations?.length ?? 0
	}

	return {
		onGroup,
		count,
	}
}
