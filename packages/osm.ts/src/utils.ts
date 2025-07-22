import { dequal } from "dequal"
import type {
	OsmEntity,
	OsmEntityType,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./types"

export function nativeCompress(data: Uint8Array) {
	const stream = new CompressionStream("deflate")
	const compressedStream = new Blob([data]).stream().pipeThrough(stream)
	return new Response(compressedStream).bytes()
}

export function assertNonNull(
	o: unknown,
	message?: string,
): asserts o is NonNullable<typeof o> {
	if (o == null) {
		throw new Error(message || "Expected non-null value")
	}
}

export async function* streamToAsyncIterator<T>(stream: ReadableStream<T>) {
	// Get a lock on the stream
	const reader = stream.getReader()

	try {
		while (true) {
			// Read from the stream
			const { done, value } = await reader.read()
			// Exit if we're done
			if (done) return
			// Else yield the chunk
			yield value
		}
	} finally {
		reader.releaseLock()
	}
}

export function isEntityEqual(a: OsmEntity, b: OsmEntity) {
	return dequal(a.tags, b.tags) && dequal(a.info, b.info)
}

export function isNode(entity: OsmEntity): entity is OsmNode {
	return "lon" in entity && "lat" in entity
}

export function isNodeEqual(a: OsmNode, b: OsmNode) {
	return a.lat === b.lat && a.lon === b.lon && isEntityEqual(a, b)
}

export function isWay(entity: OsmEntity): entity is OsmWay {
	return "refs" in entity
}

export function isRelation(entity: OsmEntity): entity is OsmRelation {
	return "members" in entity
}

export function isWayEqual(a: OsmWay, b: OsmWay) {
	return dequal(a.refs, b.refs) && isEntityEqual(a, b)
}

export function isRelationEqual(a: OsmRelation, b: OsmRelation) {
	return dequal(a.members, b.members) && isEntityEqual(a, b)
}

export function getEntityType(entity: OsmEntity): OsmEntityType {
	if (isNode(entity)) return "node"
	if (isWay(entity)) return "way"
	if (isRelation(entity)) return "relation"
	throw new Error("Unknown entity type")
}
